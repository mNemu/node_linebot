// Local smoke test, equivalent to test.gs's test_post(): feeds a sample
// LINE text-message event straight into the handler, bypassing HTTP and
// signature validation. Requires a real .env with valid LINE credentials,
// and if Calendar/mail features are enabled for the conversation, those
// credentials too.
import { selecter } from '../src/handlers/selecter.js';

const message = process.argv[2] || '@BOT 2D6';

const event = {
  type: 'message',
  message: { type: 'text', id: '459675017950265717', text: message },
  webhookEventId: '01H2Z3XJPC70ABFZ9DCQH42C96',
  deliveryContext: { isRedelivery: false },
  timestamp: Date.now(),
  source: { type: 'user', userId: 'U8da0781e19ee72360f267213c47d2f57' },
  replyToken: '8c34269424c64e41b8c65fb5f364e98e',
  mode: 'active',
};

selecter(event)
  .then(() => console.log('done'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
