import { ArrowRight, BookOpen, Check } from "lucide-react";

import type { OnboardingPayload } from "../api";
import { doneCount, nextStep, STEP_COPY } from "../onboardingSteps";
import { AppIcon } from "./AppIcon";

/**
 * The first thing a new customer sees on Home: where they are in moving in,
 * and the one thing to do next.
 *
 * **One step is the button.** Five equal calls to action is a form; one
 * coral button and four quiet rows is a path. Done steps stay listed and
 * ticked, because watching the list fill in is the reassurance.
 */
export function GettingStarted({
  state,
  onGo,
  onHide,
}: {
  state: OnboardingPayload;
  onGo: (href: string) => void;
  onHide: () => void;
}) {
  const next = nextStep(state);
  const done = doneCount(state);

  return (
    <section className="bs-panel guide" aria-labelledby="guide-title">
      <div className="bs-panel-bar guide-bar-head">
        <h2 className="bs-panel-bar-title" id="guide-title">
          Getting started
        </h2>
        <span
          className="guide-progress"
          aria-label={`${done} of ${state.steps.length} done`}
        >
          <span className="guide-progress-track" aria-hidden="true">
            <span
              className="guide-progress-fill"
              style={{ width: `${(done / state.steps.length) * 100}%` }}
            />
          </span>
          {done} of {state.steps.length}
        </span>
        <button
          type="button"
          className="bs-btn bs-btn--sm bs-btn--quiet guide-hide"
          onClick={onHide}
        >
          Hide
        </button>
      </div>
      <p className="guide-lead">
        Five steps from a shared drive of <code>Policy_FINAL_v3(2).docx</code>{" "}
        to one record everybody trusts. Stop whenever you like — this picks up
        where you left off.
      </p>
      <ol className="guide-steps">
        {state.steps.map((step, index) => {
          const copy = STEP_COPY[step.id];
          const current = next?.id === step.id;
          return (
            <li
              key={step.id}
              className={`guide-step${step.done ? " guide-step--done" : ""}${current ? " guide-step--current" : ""}`}
            >
              <span className="guide-step-mark" aria-hidden="true">
                {step.done ? <AppIcon icon={Check} size="sm" /> : index + 1}
              </span>
              <span className="guide-step-body">
                <span className="guide-step-title">
                  {copy.title}
                  {step.done ? <span className="sr-only"> — done</span> : null}
                </span>
                {current ? (
                  <span className="guide-step-why">{copy.why}</span>
                ) : null}
                {current ? (
                  <span className="guide-step-actions">
                    {step.href ? (
                      <a
                        className="bs-btn bs-btn--sm bs-btn-primary"
                        href={step.href}
                        onClick={(event) => {
                          event.preventDefault();
                          onGo(step.href!);
                        }}
                      >
                        {copy.action}
                        <AppIcon icon={ArrowRight} size="sm" />
                      </a>
                    ) : null}
                    <a
                      className="bs-btn bs-btn--sm bs-btn--quiet"
                      href={`/help/${copy.guide}`}
                      onClick={(event) => {
                        event.preventDefault();
                        onGo(`/help/${copy.guide}`);
                      }}
                    >
                      <AppIcon icon={BookOpen} size="sm" />
                      How this works
                    </a>
                  </span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/**
 * The same guide, one line tall, on every other page — so somebody who
 * followed "Make a binder" and made one is told what comes next where they
 * are, rather than having to go back to Home to find out.
 */
export function GuideBar({
  state,
  onGo,
  onHide,
}: {
  state: OnboardingPayload;
  onGo: (href: string) => void;
  onHide: () => void;
}) {
  const next = nextStep(state);
  if (!next) return null;
  const copy = STEP_COPY[next.id];
  return (
    <div className="guide-strip" role="region" aria-label="Getting started">
      <span className="guide-strip-count">
        Getting started · {doneCount(state)} of {state.steps.length}
      </span>
      <span className="guide-strip-next">
        Next: <strong>{copy.title}</strong>
      </span>
      {next.href ? (
        <a
          className="bs-btn bs-btn--sm bs-btn-secondary"
          href={next.href}
          onClick={(event) => {
            event.preventDefault();
            onGo(next.href!);
          }}
        >
          {copy.action}
        </a>
      ) : null}
      <button
        type="button"
        className="bs-btn bs-btn--sm bs-btn--quiet"
        onClick={onHide}
      >
        Hide the guide
      </button>
    </div>
  );
}
