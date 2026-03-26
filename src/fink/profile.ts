// src/fink/profile.ts
import { createClient } from '@supabase/supabase-js';
import type { SupabaseConfig } from '../config/schema.js';

export interface Profile {
  id: string;
  name: string;
  is_vouched: boolean;
  is_active: boolean;
  is_guest: boolean;
  is_admin: boolean;
  is_superuser: boolean;
  is_danbri: boolean;
  guest_color: string | null;
}

const GUEST_COLORS = ['Purple', 'Red', 'Yellow', 'Green', 'Blue', 'Orange', 'Violet'] as const;

export function makeGuestProfile(color?: string): Profile {
  const guest_color = color ?? GUEST_COLORS[Math.floor(Math.random() * GUEST_COLORS.length)]!;
  return {
    id: '',
    name: `${guest_color} Guest`,
    is_vouched: false,
    is_active: true,
    is_guest: true,
    is_admin: false,
    is_superuser: false,
    is_danbri: false,
    guest_color,
  };
}

export async function fetchProfile(config: SupabaseConfig, userId: string): Promise<Profile | null> {
  if (!config.url || !config.anonKey) return null;
  const client = createClient(config.url, config.anonKey);
  const { data, error } = await client
    .from('profiles')
    .select('id, name, is_vouched, is_active, is_guest, is_admin, is_superuser, is_danbri, guest_color')
    .eq('id', userId)
    .single();
  if (error || !data) return null;
  return data as Profile;
}

export function profileToInkVars(profile: Profile): Record<string, unknown> {
  return {
    player_name: profile.name,
    player_vouched: profile.is_vouched,
    player_guest: profile.is_guest,
    player_admin: profile.is_admin,
    player_danbri: profile.is_danbri,
    player_active: profile.is_active,
    player_guest_color: profile.guest_color ?? '',
  };
}
