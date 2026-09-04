import 'dotenv/config';

function required(name) {
  const value = process.env[name];
  if (!value) {
    console.warn(`[config] ${name} is not set - related features will fail until it is configured.`);
  }
  return value;
}

export const config = {
  selfName: process.env.SELF_NAME || '@BOT',
  port: Number(process.env.PORT) || 3000,
  dataDir: process.env.DATA_DIR || './data',

  line: {
    channelAccessToken: required('CHANNEL_ACCESS_TOKEN'),
    channelSecret: required('CHANNEL_SECRET'),
  },

  google: {
    credentialsPath: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    credentialsJson: process.env.GOOGLE_SERVICE_ACCOUNT_KEY,
  },

  mail: {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 465,
    secure: process.env.SMTP_SECURE !== 'false',
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
  },

  dailyScheduleTarget: process.env.DAILY_SCHEDULE_TARGET,

  // Score board page (public/scoreboard/). Optional shared key gating its API;
  // leave empty for open access.
  scoreboard: {
    key: process.env.SCOREBOARD_KEY || '',
  },

  // LIFF app id backing public/liff/index.html (the dice/diet input forms
  // opened from the rich menu). Managed via scripts/liff.js.
  liffId: process.env.LIFF_ID,
};
