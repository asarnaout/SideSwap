"use client";

// Career Mode's interstitial screens: the garage (morning vehicle choice), the
// end-of-day ledger, and the career-over report. Props-pure — everything they
// show arrives as data, so tests render them directly without the app shell.

import type { CountryProfile } from "./game/types";
import { formatMoney } from "./game/content";
import {
  BUYOUT_RENT_MULTIPLIER,
  CAREER_VEHICLES,
  nextInstallment,
  vehicleRent,
  type CareerSliceV1,
  type CareerVehicleId,
  type LedgerLine,
  type SettlementResult,
} from "./game/career";

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

const LEDGER_LABELS: Record<LedgerLine["kind"], string> = {
  earnings: "Fares (gross)",
  commission_info: "Platform commission",
  tips: "Tips",
  fines: "Fines",
  repairs: "Repairs & towing",
  fuel: "Fuel",
  rent_info: "Vehicle rent (prepaid)",
  platform_fee: "Platform fee",
  loan_installment: "Loan installment",
  loan_cleared: "Loan cleared",
  shortfall: "Shortfall",
  loan_origination: "New loan (incl. 15% fee)",
  final_notice: "FINAL NOTICE issued",
  bankruptcy: "Bankrupt",
  closing_balance: "Closing balance",
};

/** Kinds whose row is a banner rather than a money line. */
const BANNER_KINDS = new Set<LedgerLine["kind"]>([
  "loan_cleared",
  "final_notice",
  "bankruptcy",
]);

const cardStyle: React.CSSProperties = {
  borderRadius: "1rem",
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(15, 18, 22, 0.55)",
  padding: "1.1rem 1.25rem",
  color: "inherit",
};

export function GarageView({
  slice,
  country,
  selectedVehicleId,
  lockedVehicles,
  onSelect,
  onStartDay,
  onAbandon,
}: {
  slice: CareerSliceV1;
  country: CountryProfile;
  selectedVehicleId: CareerVehicleId;
  /** Vehicles present but not yet playable, with the reason shown on the card. */
  lockedVehicles: Readonly<Partial<Record<CareerVehicleId, string>>>;
  onSelect: (id: CareerVehicleId) => void;
  onStartDay: (id: CareerVehicleId) => void;
  onAbandon: () => void;
}) {
  const selected = CAREER_VEHICLES.find(
    (vehicle) => vehicle.id === selectedVehicleId,
  );
  const selectedRent = selected ? vehicleRent(selected, slice) : 0;
  const selectedLocked = Boolean(lockedVehicles[selectedVehicleId]);
  const selectedStartable = !selectedLocked && slice.cash >= selectedRent;
  return (
    <section className="subpage" aria-label="Career garage">
      <div className="subpage-heading">
        <div>
          <p className="eyebrow">
            CAREER · DAY {slice.day} · {country.flagEmoji}
          </p>
          <h1>Pick today&apos;s ride.</h1>
          <p>
            Rent is paid up front — every idle minute burns money you already
            spent. Cash on hand:{" "}
            <strong data-testid="garage-cash">
              {formatMoney(slice.cash, country)}
            </strong>
          </p>
        </div>
      </div>
      {slice.finalNotice && (
        <div
          role="alert"
          style={{
            ...cardStyle,
            borderColor: "#e0533f",
            background: "rgba(150, 24, 28, 0.28)",
            marginBottom: "1rem",
            fontWeight: 700,
          }}
        >
          ⚠ FINAL NOTICE — end another day short while owing and the career is
          over.
        </div>
      )}
      <div
        role="group"
        aria-label="Vehicles"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(15rem, 1fr))",
          gap: "0.9rem",
        }}
      >
        {CAREER_VEHICLES.map((vehicle) => {
          const rent = vehicleRent(vehicle, slice);
          const lockedReason = lockedVehicles[vehicle.id];
          const affordable = slice.cash >= rent;
          const disabled = Boolean(lockedReason) || !affordable;
          const active = selectedVehicleId === vehicle.id;
          const capability = vehicle.allowedGigKinds.includes("passenger")
            ? "Deliveries + rideshare"
            : "Deliveries only";
          return (
            <button
              key={vehicle.id}
              type="button"
              data-testid={`garage-vehicle-${vehicle.id}`}
              aria-pressed={active}
              disabled={disabled}
              onClick={() => onSelect(vehicle.id)}
              style={{
                ...cardStyle,
                textAlign: "left",
                cursor: disabled ? "not-allowed" : "pointer",
                opacity: disabled ? 0.45 : 1,
                borderColor: active ? "#f2c658" : "rgba(255,255,255,0.12)",
                display: "flex",
                flexDirection: "column",
                gap: "0.35rem",
              }}
            >
              <strong style={{ fontSize: "1.05rem" }}>{vehicle.name}</strong>
              <span>
                {rent === 0
                  ? vehicle.owned
                    ? "Yours — no rent"
                    : "Owned — no rent"
                  : `Rent ${formatMoney(rent, country)} / day`}
              </span>
              <small style={{ opacity: 0.75 }}>
                {capability}
                {vehicle.tankL > 0
                  ? ` · ${vehicle.tankL} L tank`
                  : " · no fuel needed"}
              </small>
              {lockedReason ? (
                <small style={{ color: "#f2c658" }}>{lockedReason}</small>
              ) : !affordable ? (
                <small style={{ color: "#e0533f" }}>Can&apos;t afford today</small>
              ) : null}
            </button>
          );
        })}
      </div>
      <div style={{ ...cardStyle, marginTop: "1rem" }} data-testid="garage-forecast">
        <strong>Tonight&apos;s obligations</strong>
        <ul style={{ margin: "0.4rem 0 0", paddingLeft: "1.1rem", opacity: 0.85 }}>
          <li>Platform fee</li>
          {slice.loan && (
            <li data-testid="forecast-installment">
              Loan installment {formatMoney(nextInstallment(slice.loan), country)}{" "}
              ({formatMoney(slice.loan.principalRemaining, country)} over{" "}
              {slice.loan.daysRemaining}{" "}
              {slice.loan.daysRemaining === 1 ? "day" : "days"})
            </li>
          )}
          <li>Anything you still owe becomes a loan (+15%)</li>
        </ul>
      </div>
      <div
        className="settings-actions"
        style={{ marginTop: "1.1rem", display: "flex", gap: "0.75rem" }}
      >
        <button type="button" className="danger-button" onClick={onAbandon}>
          Abandon career
        </button>
        <button
          type="button"
          className="primary-button"
          data-testid="garage-start-day"
          disabled={!selectedStartable}
          onClick={() => onStartDay(selectedVehicleId)}
        >
          Start Day {slice.day} →
        </button>
      </div>
    </section>
  );
}

export function LedgerView({
  result,
  slice,
  country,
  onContinue,
}: {
  result: SettlementResult;
  /** The slice AFTER settlement (already advanced to the next day). */
  slice: CareerSliceV1;
  country: CountryProfile;
  onContinue: () => void;
}) {
  return (
    <section className="subpage" aria-label="End of day ledger">
      <div className="subpage-heading">
        <div>
          <p className="eyebrow">CAREER · DAY {slice.day - 1} COMPLETE</p>
          <h1>The day&apos;s reckoning.</h1>
        </div>
      </div>
      <div style={{ ...cardStyle, maxWidth: "30rem" }}>
        <ol
          data-testid="ledger-lines"
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: "0.45rem",
          }}
        >
          {result.lines.map((line, index) => (
            <li
              key={`${line.kind}-${index}`}
              data-testid={`ledger-${line.kind}`}
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: "1rem",
                fontWeight:
                  line.kind === "closing_balance" || BANNER_KINDS.has(line.kind)
                    ? 700
                    : 500,
                color:
                  line.kind === "bankruptcy" || line.kind === "final_notice"
                    ? "#e0533f"
                    : line.kind === "loan_cleared"
                      ? "#5bbf6a"
                      : "inherit",
                borderTop:
                  line.kind === "closing_balance"
                    ? "1px solid rgba(255,255,255,0.2)"
                    : "none",
                paddingTop: line.kind === "closing_balance" ? "0.45rem" : 0,
              }}
            >
              <span>{LEDGER_LABELS[line.kind]}</span>
              {!BANNER_KINDS.has(line.kind) && (
                <strong>{formatMoney(line.amount, country)}</strong>
              )}
            </li>
          ))}
        </ol>
      </div>
      {result.outcome === "final_notice" && (
        <div
          role="alert"
          style={{
            ...cardStyle,
            borderColor: "#e0533f",
            background: "rgba(150, 24, 28, 0.28)",
            marginTop: "1rem",
            maxWidth: "30rem",
            fontWeight: 700,
          }}
        >
          ⚠ FINAL NOTICE — your debts were consolidated one last time. Another
          shortfall ends the career.
        </div>
      )}
      {slice.loan && result.outcome !== "final_notice" && (
        <p style={{ marginTop: "0.9rem", opacity: 0.85 }}>
          Outstanding debt {formatMoney(slice.loan.principalRemaining, country)}{" "}
          — next installment{" "}
          {formatMoney(nextInstallment(slice.loan), country)}.
        </p>
      )}
      <div className="settings-actions" style={{ marginTop: "1.1rem" }}>
        <button
          type="button"
          className="primary-button"
          data-testid="ledger-continue"
          onClick={onContinue}
        >
          Continue to Day {slice.day} →
        </button>
      </div>
    </section>
  );
}

export function CareerOverView({
  slice,
  country,
  onRestart,
  onMenu,
}: {
  slice: CareerSliceV1;
  country: CountryProfile;
  onRestart: () => void;
  onMenu: () => void;
}) {
  const stats = slice.stats;
  const rows: readonly (readonly [string, string])[] = [
    ["Days survived", String(stats.daysCompleted)],
    ["Gigs completed", String(stats.gigsCompleted)],
    ["On-time deliveries", String(stats.gigsOnTime)],
    ["Gross earned", formatMoney(stats.grossEarned, country)],
    ["Tips earned", formatMoney(stats.tipsEarned, country)],
    ["Fines paid", formatMoney(stats.finesPaid, country)],
    ["Loans taken", String(stats.loansTaken)],
    ["Largest debt", formatMoney(stats.largestDebt, country)],
  ];
  return (
    <section className="subpage" aria-label="Career over">
      <div className="subpage-heading">
        <div>
          <p className="eyebrow">CAREER OVER</p>
          <h1>The bank called it.</h1>
          <p>
            Day {slice.day} ended {formatMoney(slice.cash, country)} short with
            nothing left to borrow.
          </p>
        </div>
      </div>
      <div style={{ ...cardStyle, maxWidth: "26rem" }} data-testid="career-stats">
        {rows.map(([label, value]) => (
          <div
            key={label}
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: "1rem",
              padding: "0.25rem 0",
            }}
          >
            <span style={{ opacity: 0.7 }}>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <div className="settings-actions" style={{ marginTop: "1.1rem", display: "flex", gap: "0.75rem" }}>
        <button type="button" className="secondary-button" onClick={onMenu}>
          Back to menu
        </button>
        <button
          type="button"
          className="primary-button"
          data-testid="career-restart"
          onClick={onRestart}
        >
          Start a new career
        </button>
      </div>
    </section>
  );
}

/**
 * The launcher's career pane: start a fresh career in the chosen city,
 * continue the saved one, or clean up a damaged save. The buyout goal is
 * stated up front so a run has a visible finish line from day 1.
 */
export function CareerSetupPanel({
  career,
  cityName,
  country,
  onStartCareer,
  onContinue,
  onViewLastRun,
  onResetCorrupt,
  onStartFresh,
}: {
  career: CareerSliceV1 | { state: "corrupt" } | null;
  cityName: string;
  country: CountryProfile;
  onStartCareer: () => void;
  onContinue: () => void;
  onViewLastRun: () => void;
  onResetCorrupt: () => void;
  onStartFresh: () => void;
}) {
  if (career && career.state === "corrupt") {
    return (
      <div className="launcher-actions" data-testid="career-corrupt">
        <p role="alert" style={{ fontWeight: 700 }}>
          Your career save is damaged and can&apos;t be loaded.
        </p>
        <button
          type="button"
          className="danger-button"
          data-testid="career-reset-corrupt"
          onClick={onResetCorrupt}
        >
          Reset career data
        </button>
      </div>
    );
  }
  if (career && career.state === "over") {
    return (
      <div className="launcher-actions" data-testid="career-finished">
        <button
          type="button"
          className="secondary-button"
          onClick={onViewLastRun}
        >
          View last run — Day {career.day}
        </button>
        <button
          type="button"
          className="primary-button launcher-primary"
          data-testid="career-start"
          onClick={onStartFresh}
        >
          Start a new career
          <span aria-hidden="true">→</span>
        </button>
      </div>
    );
  }
  if (career) {
    return (
      <div className="launcher-actions" data-testid="career-continue-panel">
        <button
          type="button"
          className="primary-button launcher-primary"
          data-testid="career-continue"
          onClick={onContinue}
        >
          Continue career — Day {career.day} ·{" "}
          {formatMoney(career.cash, country)}
          <span aria-hidden="true">→</span>
        </button>
      </div>
    );
  }
  return (
    <div className="launcher-actions" data-testid="career-new-panel">
      <p style={{ margin: "0 0 0.5rem", opacity: 0.85 }}>
        Start broke in {cityName}. Rent your rides, out-earn your bills, and
        buy one outright ({BUYOUT_RENT_MULTIPLIER}× its daily rent) to escape
        the treadmill. Go bust twice and it&apos;s over.
      </p>
      <button
        type="button"
        className="primary-button launcher-primary"
        data-testid="career-start"
        onClick={onStartCareer}
      >
        Start career in {cityName}
        <span aria-hidden="true">→</span>
      </button>
    </div>
  );
}
