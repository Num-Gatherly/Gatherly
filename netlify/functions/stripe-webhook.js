const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  const sig = event.headers['stripe-signature'];
  let stripeEvent;

  try {
    stripeEvent = stripe.webhooks.constructEvent(
      event.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    return { statusCode: 400, body: `Webhook error: ${err.message}` };
  }

  const session = stripeEvent.data.object;

  if (stripeEvent.type === 'checkout.session.completed') {
    const userId = session.metadata.userId;
    const plan = session.metadata.plan;
    // TODO: save userId + plan to your database
    console.log(`User ${userId} subscribed to ${plan}`);
  }

  if (stripeEvent.type === 'customer.subscription.deleted') {
    const userId = session.metadata.userId;
    // TODO: remove plan from user in your database
    console.log(`User ${userId} cancelled`);
  }

  return { statusCode: 200, body: 'ok' };
};
