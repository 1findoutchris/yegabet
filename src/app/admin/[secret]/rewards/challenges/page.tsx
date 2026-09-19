"use client";

import { BlockSection } from "../editors";

export default function ChallengesPage() {
  return (
    <div className="space-y-5">
      <BlockSection blockKey="dailyChallenges" />
      <BlockSection blockKey="weeklyChallenges" />
    </div>
  );
}
