import { createClient, SupabaseClient, Session } from '@supabase/supabase-js';
import type {
  UserSignInRequest,
  UserSignInResponse,
  UserSignUpRequest,
  UserSignUpResponse,
} from '../types';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

let supabaseClient: SupabaseClient | null = null;

function getSupabaseClient(): SupabaseClient {
  if (!supabaseClient) {
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        storage: {
          getItem: async (key: string) => {
            const data = await chrome.storage.local.get(key);
            return data[key] || null;
          },
          setItem: async (key: string, value: string) => {
            await chrome.storage.local.set({ [key]: value });
          },
          removeItem: async (key: string) => {
            await chrome.storage.local.remove(key);
          },
        },
      },
    });
  }
  return supabaseClient;
}

export async function initAuth(): Promise<Session | null> {
  return getSession();
}

export async function signUp(
  request: UserSignUpRequest,
): Promise<UserSignUpResponse> {
  if (!request.isAgeVerified) {
    throw new Error('You must be 13 years or older to sign up');
  }

  const client = getSupabaseClient();
  const { data, error } = await client.auth.signUp({
    email: request.email,
    password: request.password,
  });

  if (error) throw error;
  return {
    session: data.session as Session | null,
    user: data.user,
  };
}

export async function signIn(
  request: UserSignInRequest,
): Promise<UserSignInResponse> {
  const client = getSupabaseClient();
  const { data, error } = await client.auth.signInWithPassword({
    email: request.email,
    password: request.password,
  });

  if (error) throw error;
  if (!data.session) throw new Error('No session returned');
  return {
    session: data.session as Session,
    user: data.user,
  };
}

export async function resetPassword(email: string): Promise<void> {
  const client = getSupabaseClient();
  const { error } = await client.auth.resetPasswordForEmail(email, {
    redirectTo: chrome.runtime.getURL('index.html?reset=true'),
  });

  if (error) throw error;
}

export async function updatePassword(newPassword: string): Promise<void> {
  const client = getSupabaseClient();
  const { error } = await client.auth.updateUser({
    password: newPassword,
  });

  if (error) throw error;
}

export async function getIdToken(): Promise<string> {
  const client = getSupabaseClient();
  const { data, error } = await client.auth.getSession();

  if (error) throw error;
  if (!data.session?.access_token) {
    throw new Error('No access token available. Please sign in first.');
  }

  return data.session.access_token;
}

export async function getSession(): Promise<Session | null> {
  const client = getSupabaseClient();
  const { data, error } = await client.auth.getSession();

  if (error) throw error;
  return data.session;
}

export async function signOut(): Promise<void> {
  const client = getSupabaseClient();
  const { error } = await client.auth.signOut();

  if (error) throw error;
}

export async function refreshSession(): Promise<Session | null> {
  const client = getSupabaseClient();
  const { data, error } = await client.auth.refreshSession();

  if (error) throw error;
  return data.session;
}
