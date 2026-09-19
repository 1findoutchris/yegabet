"use client";

import type { DepositBonusConfig } from "@/lib/depositBonusCore";
import { Section, DepositBonusEditor } from "../editors";

export default function DepositBonusPage() {
  return (
    <Section>
      {({ config, adminFetch }) => (
        <DepositBonusEditor
          initial={config.depositBonus as DepositBonusConfig}
          adminFetch={adminFetch}
        />
      )}
    </Section>
  );
}
