/*
 * Illustrated category icons for the lobby tiles. One style for the whole set:
 * 64×64, soft two-tone gradients from the YegaBet palette (turquoise, cyan,
 * amber, the signal red), white highlights, no outlines. Drawn for this site —
 * no third-party artwork.
 *
 * Gradient ids are fixed per icon; the same icon twice on a page repeats an
 * identical definition, which browsers render fine.
 */

type P = { className?: string };

const C = {
  teal: "#FF7A00", teal2: "#FFA040", deep: "#CC5F00", cyan: "#FFB04D",
  amber: "#F5B83D", amberD: "#C98A16", red: "#F43F5E", redD: "#B4233F",
  navy: "#1C1C1C", navy2: "#262626", white: "#FFFFFF",
};

function Svg({ className, children, id }: P & { children: React.ReactNode; id: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden data-art={id}>
      <defs>
        <linearGradient id={`${id}-t`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={C.teal2} /><stop offset="1" stopColor={C.deep} />
        </linearGradient>
        <linearGradient id={`${id}-a`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFD877" /><stop offset="1" stopColor={C.amberD} />
        </linearGradient>
        <linearGradient id={`${id}-r`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FF7A93" /><stop offset="1" stopColor={C.redD} />
        </linearGradient>
        <linearGradient id={`${id}-n`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#333333" /><stop offset="1" stopColor={C.navy} />
        </linearGradient>
      </defs>
      <ellipse cx="32" cy="58" rx="20" ry="3.2" fill="#000" opacity=".28" />
      {children}
    </svg>
  );
}

const g = (id: string, k: "t" | "a" | "r" | "n") => `url(#${id}-${k})`;

function Roulette({ className }: P) {
  const id = "ca-roulette";
  const seg = Array.from({ length: 12 }, (_, i) => {
    const a0 = (i * 30 - 90) * (Math.PI / 180), a1 = ((i + 1) * 30 - 90) * (Math.PI / 180);
    const p = (a: number, r: number) => `${32 + r * Math.cos(a)} ${30 + r * Math.sin(a)}`;
    return <path key={i} d={`M32 30L${p(a0, 20)}A20 20 0 0 1 ${p(a1, 20)}Z`} fill={i % 2 ? g(id, "r") : g(id, "n")} />;
  });
  return (
    <Svg id={id} className={className}>
      <circle cx="32" cy="30" r="25" fill={g(id, "a")} />
      <circle cx="32" cy="30" r="21.5" fill={C.navy} />
      {seg}
      <circle cx="32" cy="30" r="9" fill={g(id, "t")} />
      <circle cx="32" cy="30" r="3" fill={C.white} />
      <circle cx="44" cy="19" r="3" fill={C.white} />
    </Svg>
  );
}

function Blackjack({ className }: P) {
  const id = "ca-blackjack";
  return (
    <Svg id={id} className={className}>
      <g transform="rotate(-12 26 32)">
        <rect x="10" y="12" width="26" height="36" rx="4" fill="#E9EEF7" />
        <text x="15" y="23" fontSize="9" fontWeight="800" fill={C.navy} fontFamily="system-ui">A</text>
        <path d="M23 29c0 0-6 4.5-6 8.2a2.7 2.7 0 0 0 4.6 2c0 1.3-.6 2.6-1.5 3.4h5.8c-.9-.8-1.5-2.1-1.5-3.4a2.7 2.7 0 0 0 4.6-2C29 33.5 23 29 23 29Z" fill={C.navy} />
      </g>
      <g transform="rotate(10 40 32)">
        <rect x="28" y="12" width="26" height="36" rx="4" fill={C.white} />
        <text x="33" y="23" fontSize="9" fontWeight="800" fill={C.redD} fontFamily="system-ui">K</text>
        <path d="M41 42s-7-4.6-7-9a3.6 3.6 0 0 1 7-1.3A3.6 3.6 0 0 1 48 33c0 4.4-7 9-7 9Z" fill={g(id, "r")} />
      </g>
    </Svg>
  );
}

function Baccarat({ className }: P) {
  const id = "ca-baccarat";
  return (
    <Svg id={id} className={className}>
      <rect x="6" y="16" width="52" height="34" rx="17" fill={g(id, "t")} />
      <rect x="9" y="19" width="46" height="28" rx="14" fill="none" stroke={C.white} strokeOpacity=".5" strokeWidth="1.5" />
      <rect x="15" y="22" width="15" height="21" rx="3" fill={C.white} transform="rotate(-8 22 32)" />
      <rect x="34" y="22" width="15" height="21" rx="3" fill={C.white} transform="rotate(8 41 32)" />
      <path d="M22.5 28l2 3.5-2 3.5-2-3.5z" fill={g(id, "r")} />
      <path d="M41.5 28l2 3.5-2 3.5-2-3.5z" fill={C.navy} />
      <circle cx="32" cy="12" r="6" fill={g(id, "a")} />
      <circle cx="32" cy="12" r="3" fill="none" stroke="#fff" strokeOpacity=".7" strokeWidth="1.2" />
    </Svg>
  );
}

function GameShow({ className }: P) {
  const id = "ca-gameshow";
  const spokes = Array.from({ length: 8 }, (_, i) => {
    const a = (i * 45) * (Math.PI / 180);
    return <path key={i} d={`M32 30L${32 + 20 * Math.cos(a)} ${30 + 20 * Math.sin(a)}`} stroke={C.white} strokeOpacity=".55" strokeWidth="1.5" />;
  });
  return (
    <Svg id={id} className={className}>
      <circle cx="32" cy="30" r="24" fill={g(id, "a")} />
      <circle cx="32" cy="30" r="20" fill={g(id, "r")} />
      <path d="M32 30L52 30A20 20 0 0 1 46.1 44.1Z" fill={g(id, "t")} />
      <path d="M32 30L17.9 15.9A20 20 0 0 1 32 10Z" fill={g(id, "t")} />
      <path d="M32 30L12 30A20 20 0 0 1 17.9 15.9Z" fill={C.navy2} />
      <path d="M32 30L46.1 44.1A20 20 0 0 1 32 50Z" fill={C.navy2} />
      {spokes}
      <circle cx="32" cy="30" r="5" fill={C.white} />
      <path d="M32 2l3.5 6h-7z" fill={C.white} />
      {[0, 60, 120, 180, 240, 300].map((d) => (
        <circle key={d} cx={32 + 24 * Math.cos((d * Math.PI) / 180)} cy={30 + 24 * Math.sin((d * Math.PI) / 180)} r="1.6" fill={C.white} />
      ))}
    </Svg>
  );
}

function Chip({ cx, cy, r, fill }: { cx: number; cy: number; r: number; fill: string }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill={fill} />
      <circle cx={cx} cy={cy} r={r * 0.62} fill="none" stroke="#fff" strokeWidth={r * 0.18} strokeDasharray={`${r * 0.55} ${r * 0.42}`} />
      <circle cx={cx} cy={cy} r={r * 0.38} fill="#fff" fillOpacity=".9" />
    </g>
  );
}

function Poker({ className }: P) {
  const id = "ca-poker";
  return (
    <Svg id={id} className={className}>
      <rect x="27" y="9" width="24" height="33" rx="4" fill={C.white} transform="rotate(14 39 25)" />
      <path d="M43 18c0 0-5 3.8-5 7a2.3 2.3 0 0 0 3.9 1.7c0 1.1-.5 2.2-1.3 2.9h4.8c-.8-.7-1.3-1.8-1.3-2.9A2.3 2.3 0 0 0 48 25c0-3.2-5-7-5-7Z" fill={C.navy} transform="rotate(14 39 25)" />
      <Chip cx={22} cy={42} r={13} fill={g(id, "r")} />
      <Chip cx={22} cy={33} r={13} fill={g(id, "t")} />
      <Chip cx={22} cy={24} r={13} fill={g(id, "a")} />
    </Svg>
  );
}

function DragonTiger({ className }: P) {
  const id = "ca-dragontiger";
  return (
    <Svg id={id} className={className}>
      <rect x="6" y="14" width="24" height="34" rx="5" fill={g(id, "r")} />
      <rect x="34" y="14" width="24" height="34" rx="5" fill={g(id, "a")} />
      <path d="M12 38c3-9 9-14 13-13-2 2-3 4-2 6 2-1 4-1 5 1-4 0-7 3-8 6z" fill="#fff" fillOpacity=".92" />
      <path d="M40 26l3 3 3-3 3 3 3-3v12a9 9 0 0 1-12 0z" fill={C.navy} fillOpacity=".85" />
      <circle cx="43.5" cy="33" r="1.4" fill={C.amber} /><circle cx="48.5" cy="33" r="1.4" fill={C.amber} />
      <circle cx="32" cy="31" r="7" fill={C.navy} stroke="#fff" strokeOpacity=".7" strokeWidth="1.5" />
      <text x="32" y="34.5" textAnchor="middle" fontSize="8" fontWeight="900" fill="#fff" fontFamily="system-ui">VS</text>
    </Svg>
  );
}

function Dice({ className }: P) {
  const id = "ca-dice";
  const dot = (x: number, y: number) => <circle cx={x} cy={y} r="2.6" fill={C.navy} />;
  return (
    <Svg id={id} className={className}>
      <g transform="rotate(-14 22 34)">
        <rect x="8" y="20" width="28" height="28" rx="7" fill={C.white} />
        {dot(15, 27)}{dot(29, 27)}{dot(22, 34)}{dot(15, 41)}{dot(29, 41)}
      </g>
      <g transform="rotate(12 42 26)">
        <rect x="28" y="10" width="28" height="28" rx="7" fill={g(id, "r")} />
        <circle cx="35" cy="17" r="2.6" fill="#fff" /><circle cx="42" cy="24" r="2.6" fill="#fff" /><circle cx="49" cy="31" r="2.6" fill="#fff" />
      </g>
    </Svg>
  );
}

function Cards({ className }: P) {
  const id = "ca-cards";
  return (
    <Svg id={id} className={className}>
      <rect x="10" y="14" width="24" height="34" rx="4" fill={g(id, "t")} transform="rotate(-16 22 31)" />
      <rect x="20" y="11" width="24" height="34" rx="4" fill={C.white} />
      <rect x="30" y="14" width="24" height="34" rx="4" fill={g(id, "a")} transform="rotate(16 42 31)" />
      <path d="M32 21l4.5 7-4.5 7-4.5-7z" fill={g(id, "r")} />
    </Svg>
  );
}

function Crash({ className }: P) {
  const id = "ca-crash";
  return (
    <Svg id={id} className={className}>
      <path d="M6 50C20 48 34 38 44 18" fill="none" stroke={g(id, "r")} strokeWidth="4" strokeLinecap="round" />
      <path d="M6 50C20 48 34 38 44 18L44 50Z" fill={C.red} opacity=".18" />
      <g transform="rotate(35 46 16)">
        <path d="M46 2c6 5 8 12 7 20H39c-1-8 1-15 7-20z" fill={C.white} />
        <circle cx="46" cy="12" r="3" fill={g(id, "t")} />
        <path d="M39 18l-5 6h5zM53 18l5 6h-5z" fill={g(id, "r")} />
        <path d="M42 22h8l-4 9z" fill={g(id, "a")} />
      </g>
      <text x="8" y="22" fontSize="11" fontWeight="900" fill={C.amber} fontFamily="system-ui">x</text>
      <text x="15" y="22" fontSize="11" fontWeight="900" fill="#fff" fontFamily="system-ui">2.5</text>
    </Svg>
  );
}

function Mines({ className }: P) {
  const id = "ca-mines";
  return (
    <Svg id={id} className={className}>
      {[0, 1, 2].map((r) => [0, 1, 2].map((c) => (
        <rect key={`${r}${c}`} x={8 + c * 17} y={6 + r * 17} width="14" height="14" rx="3.5"
          fill={(r === 1 && c === 1) ? C.navy : (r + c) % 2 ? g(id, "n") : g(id, "t")} opacity={(r === 1 && c === 1) ? 1 : 0.95} />
      )))}
      <path d="M32 26l5 4-5 8-5-8z" fill={C.cyan} />
      <path d="M27 30h10l-5 8z" fill={C.teal2} />
      <circle cx="49" cy="45" r="8" fill={C.navy} />
      <circle cx="49" cy="45" r="8" fill="none" stroke={C.red} strokeWidth="2" />
      <path d="M53 38l3-3" stroke={C.amber} strokeWidth="2" strokeLinecap="round" />
      <circle cx="46.5" cy="42.5" r="2" fill="#fff" fillOpacity=".6" />
    </Svg>
  );
}

function Plinko({ className }: P) {
  const id = "ca-plinko";
  const pegs: React.ReactNode[] = [];
  for (let r = 0; r < 4; r++) for (let c = 0; c <= r; c++) pegs.push(<circle key={`${r}-${c}`} cx={32 - r * 7 + c * 14} cy={12 + r * 9} r="2.2" fill="#fff" fillOpacity=".85" />);
  return (
    <Svg id={id} className={className}>
      <path d="M32 4L58 46H6z" fill={g(id, "n")} />
      {pegs}
      <circle cx="39" cy="21" r="4" fill={g(id, "a")} />
      {[0, 1, 2, 3, 4].map((i) => (
        <rect key={i} x={8 + i * 10} y="47" width="8" height="7" rx="2" fill={i === 2 ? g(id, "a") : i % 2 ? g(id, "r") : g(id, "t")} />
      ))}
    </Svg>
  );
}

function Wheel({ className }: P) {
  const id = "ca-wheel";
  const cols = [g(id, "t"), g(id, "a"), g(id, "r"), g(id, "n")];
  const seg = Array.from({ length: 8 }, (_, i) => {
    const a0 = (i * 45 - 90) * (Math.PI / 180), a1 = ((i + 1) * 45 - 90) * (Math.PI / 180);
    const p = (a: number) => `${32 + 22 * Math.cos(a)} ${32 + 22 * Math.sin(a)}`;
    return <path key={i} d={`M32 32L${p(a0)}A22 22 0 0 1 ${p(a1)}Z`} fill={cols[i % 4]} />;
  });
  return (
    <Svg id={id} className={className}>
      <circle cx="32" cy="32" r="25" fill={C.white} />
      {seg}
      <circle cx="32" cy="32" r="6" fill={C.white} />
      <circle cx="32" cy="32" r="2.5" fill={C.navy} />
      <path d="M32 2l5 9h-10z" fill={C.white} stroke={C.navy} strokeWidth="1" />
    </Svg>
  );
}

function Instant({ className }: P) {
  const id = "ca-instant";
  return (
    <Svg id={id} className={className}>
      <circle cx="32" cy="30" r="24" fill={g(id, "t")} />
      <circle cx="32" cy="30" r="19" fill={C.navy} />
      <path d="M35 9L20 34h10l-3 19 17-27H33z" fill={g(id, "a")} />
      <path d="M35 9L20 34h6z" fill="#fff" fillOpacity=".35" />
    </Svg>
  );
}

function Keno({ className }: P) {
  const id = "ca-keno";
  const balls: [number, number, "t" | "a" | "r", string][] = [[20, 38, "t", "7"], [42, 38, "r", "21"], [31, 20, "a", "8"]];
  return (
    <Svg id={id} className={className}>
      {balls.map(([x, y, k, n]) => (
        <g key={n}>
          <circle cx={x} cy={y} r="13" fill={g(id, k)} />
          <circle cx={x} cy={y} r="7.5" fill="#fff" />
          <text x={x} y={y + 3.3} textAnchor="middle" fontSize="9" fontWeight="900" fill={C.navy} fontFamily="system-ui">{n}</text>
          <circle cx={x - 6} cy={y - 7} r="2.5" fill="#fff" fillOpacity=".45" />
        </g>
      ))}
    </Svg>
  );
}

function Lottery({ className }: P) {
  const id = "ca-lottery";
  return (
    <Svg id={id} className={className}>
      <path d="M8 18h48v8a6 6 0 0 0 0 12v8H8v-8a6 6 0 0 0 0-12z" fill={g(id, "a")} transform="rotate(-8 32 32)" />
      <path d="M22 20v24" stroke={C.navy} strokeOpacity=".4" strokeWidth="1.6" strokeDasharray="3 3" transform="rotate(-8 32 32)" />
      <path d="M38 24l2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.6-4.8 2.6.9-5.4-3.9-3.8 5.4-.8z" fill={C.white} transform="rotate(-8 32 32)" />
    </Svg>
  );
}

function Fishing({ className }: P) {
  const id = "ca-fishing";
  return (
    <Svg id={id} className={className}>
      <path d="M8 46c6-3 10-3 16 0s10 3 16 0 10-3 16 0" fill="none" stroke={C.cyan} strokeWidth="2.5" strokeLinecap="round" opacity=".7" />
      <path d="M12 28c8-12 26-12 34 0-8 12-26 12-34 0z" fill={g(id, "a")} />
      <path d="M46 28l10-8v16z" fill={g(id, "r")} />
      <circle cx="21" cy="26" r="2.6" fill={C.navy} />
      <path d="M28 21c3 4 3 10 0 14" fill="none" stroke="#fff" strokeOpacity=".6" strokeWidth="1.8" />
      <circle cx="50" cy="10" r="3" fill={C.cyan} opacity=".7" /><circle cx="44" cy="6" r="2" fill={C.cyan} opacity=".5" />
    </Svg>
  );
}

function Arcade({ className }: P) {
  const id = "ca-arcade";
  return (
    <Svg id={id} className={className}>
      <rect x="6" y="20" width="52" height="26" rx="13" fill={g(id, "t")} />
      <path d="M17 29v10M12 34h10" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" />
      <circle cx="42" cy="30" r="3.6" fill={g(id, "a")} /><circle cx="49" cy="37" r="3.6" fill={g(id, "r")} />
      <rect x="27" y="31" width="8" height="3" rx="1.5" fill={C.navy} opacity=".5" />
    </Svg>
  );
}

function Slots({ className }: P) {
  const id = "ca-slots";
  return (
    <Svg id={id} className={className}>
      <rect x="6" y="10" width="46" height="42" rx="8" fill={g(id, "r")} />
      <rect x="11" y="19" width="36" height="22" rx="4" fill="#fff" />
      {[0, 1, 2].map((i) => (
        <text key={i} x={17.5 + i * 11.5} y="35" textAnchor="middle" fontSize="13" fontWeight="900" fill={i === 1 ? C.redD : C.amberD} fontFamily="system-ui">7</text>
      ))}
      <path d="M52 22h4v14" stroke={C.white} strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <circle cx="56" cy="19" r="4" fill={g(id, "a")} />
      <rect x="14" y="44" width="30" height="4" rx="2" fill={g(id, "a")} />
    </Svg>
  );
}

function Live({ className }: P) {
  const id = "ca-live";
  return (
    <Svg id={id} className={className}>
      <rect x="6" y="12" width="52" height="36" rx="8" fill={g(id, "n")} />
      <circle cx="32" cy="27" r="7" fill={g(id, "a")} />
      <path d="M19 48c2-9 7-13 13-13s11 4 13 13z" fill={g(id, "t")} />
      <rect x="10" y="16" width="16" height="7" rx="3.5" fill={g(id, "r")} />
      <circle cx="14" cy="19.5" r="1.6" fill="#fff" />
      <text x="17.5" y="22" fontSize="5.5" fontWeight="900" fill="#fff" fontFamily="system-ui">LIVE</text>
    </Svg>
  );
}

function Star({ className }: P) {
  const id = "ca-star";
  return (
    <Svg id={id} className={className}>
      <path d="M32 6l7.6 15.4 17 2.5-12.3 12 2.9 16.9L32 44.8l-15.2 8 2.9-16.9-12.3-12 17-2.5z" fill={g(id, "a")} />
      <path d="M32 6l7.6 15.4L32 26z" fill="#fff" fillOpacity=".35" />
    </Svg>
  );
}

function Sparkle({ className }: P) {
  const id = "ca-new";
  return (
    <Svg id={id} className={className}>
      <path d="M28 6c2 12 6 16 18 18-12 2-16 6-18 18-2-12-6-16-18-18 12-2 16-6 18-18z" fill={g(id, "t")} />
      <path d="M48 34c1 6 3 8 9 9-6 1-8 3-9 9-1-6-3-8-9-9 6-1 8-3 9-9z" fill={g(id, "a")} />
    </Svg>
  );
}

function Grid({ className }: P) {
  const id = "ca-all";
  return (
    <Svg id={id} className={className}>
      <rect x="8" y="8" width="21" height="21" rx="6" fill={g(id, "t")} />
      <rect x="35" y="8" width="21" height="21" rx="6" fill={g(id, "a")} />
      <rect x="8" y="35" width="21" height="21" rx="6" fill={g(id, "r")} />
      <rect x="35" y="35" width="21" height="21" rx="6" fill={g(id, "n")} />
    </Svg>
  );
}

export const CATEGORY_ART: Record<string, React.ComponentType<P>> = {
  all: Grid, other: Grid,
  roulette: Roulette, blackjack: Blackjack, baccarat: Baccarat, gameshow: GameShow, poker: Poker,
  dragontiger: DragonTiger, dice: Dice, cards: Cards, table: Cards,
  crash: Crash, mines: Mines, plinko: Plinko, wheel: Wheel, instant: Instant,
  keno: Keno, lottery: Lottery, fishing: Fishing, arcade: Arcade,
  slots: Slots, live: Live, popular: Star, hot: Star, new: Sparkle,
};
