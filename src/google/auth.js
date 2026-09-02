import { GoogleAuth } from 'google-auth-library';
import { config } from '../config.js';

const SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/calendar',
];

let authClient;

function credentialsOption() {
  if (config.google.credentialsJson) {
    return { credentials: JSON.parse(config.google.credentialsJson) };
  }
  if (config.google.credentialsPath) {
    return { keyFile: config.google.credentialsPath };
  }
  // Falls back to Application Default Credentials (e.g. GCE/Cloud Run metadata server).
  return {};
}

export function getGoogleAuth() {
  if (!authClient) {
    authClient = new GoogleAuth({ ...credentialsOption(), scopes: SCOPES });
  }
  return authClient;
}

export async function getAuthClient() {
  return getGoogleAuth().getClient();
}
