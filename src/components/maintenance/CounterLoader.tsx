import { useEffect, useState } from "react";
import { remainingTime } from "../../lib/siteAvailability";

// Original implementation inspired by the seven-segment/grid visual of
// Md afsar mahmud's Counter Loader: https://21st.dev/@mdafsarx/components/counter-loader
// Its source is access-restricted. No source was copied. Unlike the looping
// preloader, each digit here represents the actual server-calibrated deadline.
const segments = [
  "abcedf",
  "bc",
  "abged",
  "abgcd",
  "fgbc",
  "afgcd",
  "afgecd",
  "abc",
  "abcdefg",
  "abfgcd",
];

function Digit({ value }: { value: string }) {
  return (
    <span className="counter-digit" aria-hidden="true">
      {"abcdefg".split("").map((segment) => (
        <i
          key={segment}
          className={`counter-segment counter-segment--${segment}${segments[Number(value)]!.includes(segment) ? " is-lit" : ""}`}
        />
      ))}
    </span>
  );
}

export function CounterLoader({
  endsAt,
  clockOffset = 0,
}: {
  endsAt: string;
  clockOffset?: number;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const time = remainingTime(endsAt, now + clockOffset);
  const groups = [
    ...(time.days > 0 ? [{ value: time.days, label: "jours" }] : []),
    { value: time.hours, label: "heures" },
    { value: time.minutes, label: "minutes" },
    { value: time.seconds, label: "secondes" },
  ];
  return (
    <div className="maintenance-clock">
      <div
        className="segment-counter"
        role="timer"
        aria-live="off"
        aria-label={`${time.days} jours, ${time.hours} heures, ${time.minutes} minutes et ${time.seconds} secondes avant la réouverture prévue`}
      >
        {groups.map((group) => (
          <div className="counter-group" key={group.label}>
            <span className="counter-digits">
              {String(group.value)
                .padStart(2, "0")
                .split("")
                .map((digit, i) => (
                  <Digit key={i} value={digit} />
                ))}
            </span>
            <span className="counter-unit" aria-hidden="true">
              {group.label}
            </span>
          </div>
        ))}
      </div>
      {time.total === 0 && <p role="status">Vérification de la réouverture…</p>}
    </div>
  );
}
