import "next-auth";

declare module "next-auth" {
  interface User {
    id: string;
    username: string;
    name?: string | null;
    phone: string;
    role: string;
  }

  interface Session {
    user: {
      id: string;
      username: string;
      phone: string;
      role: string;
      email?: string | null;
      name?: string | null;
      image?: string | null;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    username: string;
    name?: string | null;
    phone: string;
    role: string;
  }
}
