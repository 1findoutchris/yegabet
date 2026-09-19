/*
 * The mutable session the mocked `auth()` reads (see tests/db/setup.ts).
 *
 * Kept in its own module so `vi.mock` — which is hoisted above imports — can
 * reach it without tripping over the hoisting rules.
 */

interface TestSession {
  user: { id: string; username: string; phone: string; role: string; name?: string | null };
}

export const current: { session: TestSession | null } = { session: null };

/** Authenticate subsequent route calls as this user. */
export function asUser(user: {
  id: string;
  username?: string;
  phone?: string;
  role?: string;
  name?: string | null;
}): void {
  current.session = {
    user: {
      username: "testuser",
      phone: "+251900000000",
      role: "USER",
      name: null,
      ...user,
    },
  };
}

/** Log out — routes should then return 401. */
export function asAnon(): void {
  current.session = null;
}
