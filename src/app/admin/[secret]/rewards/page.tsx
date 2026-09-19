"use client";

import { Section, EconomyEditor } from "./editors";

export default function PointsEconomyPage() {
  return (
    <Section>
      {({ config, adminFetch }) => (
        <EconomyEditor
          initial={config.pointsEconomy as Record<string, number>}
          adminFetch={adminFetch}
        />
      )}
    </Section>
  );
}
