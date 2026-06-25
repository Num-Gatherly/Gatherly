const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const PRICES = {
  pro: 'price_1TmA1S0dkUHZjHX0yqNhR8fU',
  ultra: 'price_1TmA1n0dkUHZjHX0zq1Avg6p'
};

exports.handler = async (event) => {
  const { plan, userId } = JSON.parse(event.body);

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: [{ price: PRICES[plan], quantity: 1 }],
    mode: 'subscription',
    subscription_data: {
      metadata: { userId }
    },
    success_url: 'https://gatherly-events.netlify.app/dashboard?success=true',
    cancel_url: 'https://gatherly-events.netlify.app/pricing',
    metadata: { userId, plan }
  });

  return {
    statusCode: 200,
    body: JSON.stringify({ url: session.url })
  };
};
