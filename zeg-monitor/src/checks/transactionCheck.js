import Stripe from "stripe";
// api/stripe-webhook.js
// Deploy this on Vercel (free tier is fine). This is the piece that makes
// payment actually unlock the course — right now nothing does that.
//
// What it does:
// 1. Stripe calls this URL automatically the instant a payment succeeds
// 2. We verify the request really came from Stripe (not someone faking it)
// 3. We create/find the student's account and insert an "enrollment" row
// 4. We automatically email them their access instructions via Resend

//
// You will need to set these as Environment Variables in Vercel:
//   STRIPE_SECRET_KEY        (from Stripe dashboard)
//   STRIPE_WEBHOOK_SECRET    (Stripe gives you this when you register the webhook)
//   SUPABASE_URL             (from your Supabase project settings)
//   SUPABASE_SERVICE_ROLE_KEY (from Supabase — NOT the anon key, this one bypasses RLS)
//   RESEND_API_KEY           (from resend.com — requires zegtrust.org to be a verified sending domain)

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export const config = {
  api: { bodyParser: false } // Stripe needs the raw request body to verify signatures
};

async function buffer(readable) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method not allowed');
  }

  const rawBody = await buffer(req);
  const signature = req.headers['stripe-signature'];

  let event;
  try {
    // This line is the security check — it proves the request really came
    // from Stripe and wasn't someone hitting this URL directly to fake a payment.
    event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const email = session.customer_details?.email;
    const amountPaid = session.amount_total;

    if (!email) {
      console.error('No email on checkout session:', session.id);
      return res.status(200).json({ received: true, warning: 'no email found' });
    }

    try {
      // Find or create the Supabase auth user for this email.
      // Using service_role key here, so this bypasses RLS — that's intentional
      // and safe, because only our server (not visitors) has this key.
      let userId;
      let setupLink = null;
      const { data: existingUsers } = await supabase.auth.admin.listUsers();
      const existing = existingUsers?.users?.find(u => u.email === email);

      if (existing) {
        userId = existing.id;
      } else {
        const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
          email,
          email_confirm: true, // they paid, so skip the confirmation email step
          user_metadata: { full_name: session.customer_details?.name || '' }
        });
        if (createError) throw createError;
        userId = newUser.user.id;

        // Generate a "set your password" link since we created the account
        // for them. We capture the actual link this time so it can go in
        // the welcome email below — previously this was generated but never
        // actually sent anywhere.
        const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
          type: 'recovery',
          email
        });
        if (linkError) {
          console.error('Could not generate account setup link:', linkError);
        } else {
          setupLink = linkData?.properties?.action_link || null;
        }
      }

      // This insert is the actual moment access gets unlocked. It also
      // records proof of agreement: which policy version was live when
      // this student paid, and exactly when that enrollment was recorded.
      // POLICY_VERSION below must be updated any time the live Privacy
      // Policy / Terms / Refund Policy pages are materially changed.
      const POLICY_VERSION = '2026-08-22';

      const { error: enrollError } = await supabase.from('enrollments').insert({
        user_id: userId,
        course_id: 'pbws',
        stripe_session_id: session.id,
        stripe_customer_email: email,
        amount_paid_cents: amountPaid,
        policy_version: POLICY_VERSION,
        consent_recorded_at: new Date().toISOString()
      });

      if (enrollError && enrollError.code !== '23505') {
        // 23505 = unique violation, meaning this session was already processed
        // (Stripe sometimes sends the same webhook twice — this makes it safe)
        throw enrollError;
      }

      console.log(`Enrolled ${email} in PBWS course.`);

      // The actual automated email — this is what used to be a manual step.
      await sendWelcomeEmail({
        to: email,
        name: session.customer_details?.name || '',
        setupLink // null for a returning/already-set-up student
      });

    } catch (err) {
      console.error('Enrollment error:', err);
      // Still return 200 so Stripe doesn't keep retrying forever — but this
      // error needs to reach you somehow. Recommend adding error alerting
      // (e.g. a Slack webhook or email-yourself) here before going live.
      return res.status(200).json({ received: true, error: err.message });
    }
  }

  res.status(200).json({ received: true });
}

// Sends the enrollment confirmation / account-setup email via Resend.
// Requires RESEND_API_KEY as an environment variable, and requires the
// sending domain (zegtrust.org) to be verified in your Resend account —
// otherwise Resend will reject the send.
async function sendWelcomeEmail({ to, name, setupLink }) {
  if (!process.env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY is not set — skipping welcome email.');
    return;
  }

  const greeting = name ? `Hi ${name},` : 'Hi,';

  const bodyHtml = setupLink
    ? `
      <p>${greeting}</p>
      <p>Thanks for enrolling in the Professional Beauty Wellness Specialist (PBWS) certification!</p>
      <p>Click below to set your password and access the Academy:</p>
      <p><a href="${setupLink}" style="display:inline-block;background:#C9A24B;color:#000;padding:12px 24px;text-decoration:none;border-radius:4px;font-weight:bold;">Set Your Password &amp; Sign In</a></p>
      <p>Once your password is set, sign in any time at <a href="https://zegtrust.org">zegtrust.org</a> using this same email address.</p>
      <p>Questions? Just reply to this email.</p>
      <p>Welcome to the Academy,<br>Huni Ali</p>
    `
    : `
      <p>${greeting}</p>
      <p>Thanks for enrolling in the Professional Beauty Wellness Specialist (PBWS) certification!</p>
      <p>Your account is already active — sign in any time at <a href="https://zegtrust.org">zegtrust.org</a> using this same email address.</p>
      <p>Questions? Just reply to this email.</p>
      <p>Welcome to the Academy,<br>Huni Ali</p>
    `;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Diwan El-Mahrifah Wellness Academy <access@zegtrust.org>',
        to: [to],
        subject: 'Your PBWS Academy Access',
        html: bodyHtml
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('Resend API error:', res.status, errText);
    } else {
      console.log(`Welcome email sent to ${to}`);
    }
  } catch (err) {
    // Never let an email failure block enrollment — the student is already
    // enrolled at this point regardless of whether this email succeeds.
    console.error('Failed to send welcome email:', err);
  }
}


 
   
      
