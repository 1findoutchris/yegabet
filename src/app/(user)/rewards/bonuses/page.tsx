import { CashbackCard } from "@/components/retention/CashbackCard";
import { BonusCenter } from "@/components/retention/BonusCenter";

export default function BonusesPage() {
  return (
    <div className="flex flex-col gap-8">
      <CashbackCard />
      <BonusCenter />
    </div>
  );
}
