import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

export async function runTransactionCheck(env) {
const steps = [];
const stripe = new Stripe(env.STRIPE_TEST_SECRET_KEY);
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const testEmail = `monitor-test+${Date.now()}@zegtrust-check.invalid`;

try {
// 1. Create a Checkout Session — same object type your real Payment Link
// generates — so it exercises the exact same webhook event.
const session = await stripe.checkout.sessions.create({
mode: "payment",
payment_method_types: ["card"],
customer_email: testEmail,
line_items: [
{
price_data: {
currency: "usd",
product_data: { name: "PBWS Academy — Automated Monitor Test" },
unit_amount: 14900,
},
quantity: 1,
},
],
success_url: "https://zegtrust.org/?monitor=success",
cancel_url: "https://zegtrust.org/?monitor=cancel",
metadata: { source: "automated-monitor", test: "true" },
});

steps.push({ name: "Checkout session created", ok: true, detail: session.id });

// 2. Confirm the session's underlying PaymentIntent directly via the API
// (bypassing the hosted checkout page). Stripe still marks the
// Checkout Session complete and fires checkout.session.completed —
// the same event your live webhook listens for.
const confirmed = await stripe.paymentIntents.confirm(session.payment_intent, {
payment_method: "pm_card_visa",
});

const paymentOk = confirmed.status === "succeeded";
steps.push({
name: "Test payment confirmed",
ok: paymentOk,
detail: `status=${confirmed.status}`,
});
if (!paymentOk) throw new Error("Payment did not succeed");

// 3. Wait for checkout.session.completed -> your webhook -> Supabase write.
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

const emailOk = await checkResendSent(env, testEmail);
steps.push({
name: "Welcome email dispatched",
ok: emailOk,
detail: emailOk ? "found matching send in Resend logs" : "no matching send found",
});

await cleanup(supabase, env, testEmail);
steps.push({ name: "Test record cleanup", ok: true, detail: "deleted" });

const ok = steps.every((s) => s.ok || s.name === "Welcome email dispatched");
return { ok, steps };
} catch (err) {
await cleanup(supabase, env, testEmail).catch(() => {});
return { ok: false, steps, error: err.message };
}
}

async function cleanup(supabase, env, testEmail) {
await supabase.from(env.SUPABASE_STUDENTS_TABLE).delete().eq(env.SUPABASE_LOOKUP_COLUMN, testEmail);
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


 
   
      
