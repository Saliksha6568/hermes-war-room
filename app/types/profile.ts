export interface Profile {
  slug: string
  displayName: string
  givenName: string | null
  isDefault: boolean
  active: boolean
  hermesDir: string
  backgroundColor: string
  gesture: string
  avatarSeed: string
  avatarUrl: string
  avatarPortraitUrl: string
  firstSeen: string
  lastSeen: string
}
