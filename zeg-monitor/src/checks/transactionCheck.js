import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

/**
 * Runs a real test-mode payment through the ZEG payment -> webhook ->
 * Supabase -> welcome email pipeline, then verifies each stage landed
 * and cleans up the test record.
 *
 * Returns { ok: boolean, steps: [{name, ok, detail}], error? }
 */
export async function runTransactionCheck(env) {
  const steps = [];
  const stripe = new Stripe(env.STRIPE_TEST_SECRET_KEY);
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  const testEmail = `monitor-test+${Date.now()}@zegtrust-check.invalid`;

  try {
    // 1. Create a test-mode payment using Stripe's standard test card token.
    //    This exercises the same Checkout/PaymentIntent path real students use.
    const paymentIntent = await stripe.paymentIntents.create({
      amount: 14900, // matches PBWS launch price, in cents
      currency: "usd",
      payment_method: "pm_card_visa", // Stripe's built-in test payment method
      confirm: true,
      receipt_email: testEmail,
      automatic_payment_methods: { enabled: true, allow_redirects: "never" },
      metadata: { source: "automated-monitor", test: "true" },
    });

    const paymentOk = paymentIntent.status === "succeeded";
    steps.push({
      name: "Stripe test payment",
      ok: paymentOk,
      detail: `status=${paymentIntent.status}, id=${paymentIntent.id}`,
    });
    if (!paymentOk) throw new Error("Stripe payment did not succeed");

    // 2. Wait for the webhook to fire and create the Supabase record.
    //    Poll for up to ~30s since webhook delivery isn't instant.
    const record = await pollForRecord(supabase, env, testEmail, 30_000);
    const webhookOk = !!record;
    steps.push({
      name: "Webhook -> Supabase account creation",
      ok: webhookOk,
      detail: webhookOk
        ? `record found in ${env.SUPABASE_STUDENTS_TABLE} within 30s`
        : "no record appeared within 30s — webhook may be broken",
    });
    if (!webhookOk) throw new Error("No Supabase record created by webhook");

    // 3. Verify Resend actually sent the welcome email for this test account.
    //    (Best-effort — Resend's API only confirms send attempt, not delivery.)
    const emailOk = await checkResendSent(env, testEmail);
    steps.push({
      name: "Welcome email dispatched",
      ok: emailOk,
      detail: emailOk ? "found matching send in Resend logs" : "no matching send found",
    });

    // 4. Cleanup: remove the test student record so it never appears in
    //    real reporting/admin dashboards.
    await supabase
      .from(env.SUPABASE_STUDENTS_TABLE)
      .delete()
      .eq(env.SUPABASE_LOOKUP_COLUMN, testEmail);
    steps.push({ name: "Test record cleanup", ok: true, detail: "deleted" });

    const ok = steps.every((s) => s.ok || s.name === "Welcome email dispatched"); // email check is informational, not blocking
    return { ok, steps };
  } catch (err) {
    // Best-effort cleanup even on failure, so a broken run doesn't leave junk data.
    try {
      await supabase
        .from(env.SUPABASE_STUDENTS_TABLE)
        .delete()
        .eq(env.SUPABASE_LOOKUP_COLUMN, testEmail);
    } catch (_) {
      /* ignore cleanup failure, already reporting the primary error */
    }
    return { ok: false, steps, error: err.message };
  }
}

async function pollForRecord(supabase, env, testEmail, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { data } = await supabase
      .from(env.SUPABASE_STUDENTS_TABLE)
      .select("*")
      .eq(env.SUPABASE_LOOKUP_COLUMN, testEmail)
      .limit(1);
    if (data && data.length > 0) return data[0];
    await new Promise((r) => setTimeout(r, 3000));
  }
  return null;
}

async function checkResendSent(env, testEmail) {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` },
    });
    if (!res.ok) return false;
    const body = await res.json();
    const list = body?.data || [];
    return list.some((e) => e.to?.includes(testEmail));
  } catch {
    return false;
  }
}
