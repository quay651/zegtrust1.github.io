import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

export async function runTransactionCheck(env) {
const steps = [];
const stripe = new Stripe(env.STRIPE_TEST_SECRET_KEY);
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const testEmail = `monitor-test+${Date.now()}@zegtrust-check.invalid`;
let createdUserId = null;

try {
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

const confirmed = await stripe.paymentIntents.confirm(session.payment_intent, {
payment_method: "pm_card_visa",
});
const paymentOk = confirmed.status === "succeeded";
steps.push({ name: "Test payment confirmed", ok: paymentOk, detail: `status=${confirmed.status}` });
if (!paymentOk) throw new Error("Payment did not succeed");

const enrollment = await pollForEnrollment(supabase, session.id, 30_000);
const webhookOk = !!enrollment;
steps.push({
name: "Webhook -> enrollment created",
ok: webhookOk,
detail: webhookOk
? `enrollment row found for session ${session.id} within 30s`
: "no enrollment row appeared within 30s — webhook may be broken",
});
if (!webhookOk) throw new Error("No enrollment row created by webhook");

createdUserId = enrollment.user_id;

const emailOk = await checkResendSent(env, testEmail);
steps.push({
name: "Welcome email dispatched",
ok: emailOk,
detail: emailOk ? "found matching send in Resend logs" : "no matching send found",
});

await cleanup(supabase, session.id, createdUserId);
steps.push({ name: "Test record cleanup", ok: true, detail: "enrollment row + auth user deleted" });

const ok = steps.every((s) => s.ok || s.name === "Welcome email dispatched");
return { ok, steps };
} catch (err) {
await cleanup(supabase, null, createdUserId).catch(() => {});
return { ok: false, steps, error: err.message };
}
}

async function cleanup(supabase, sessionId, userId) {
if (sessionId) {
await supabase.from("enrollments").delete().eq("stripe_session_id", sessionId);
}
if (userId) {
await supabase.auth.admin.deleteUser(userId).catch(() => {});
}
}

async function pollForEnrollment(supabase, sessionId, timeoutMs) {
const start = Date.now();
while (Date.now() - start < timeoutMs) {
const { data } = await supabase
.from("enrollments")
.select("*")
.eq("stripe_session_id", sessionId)
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
