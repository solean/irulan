import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import { getStatusBadgeVariant } from "../lib/status";
import { CheckIcon } from "./icons";
export type OnboardingStep = {
  id: string;
  title: string;
  description: string;
  done: boolean;
  actionLabel: string;
  onAction: () => void;
  actionDisabled?: boolean;
};

export const OnboardingChecklist = ({
  steps,
  onDismiss,
}: {
  steps: OnboardingStep[];
  onDismiss: () => void;
}) => {
  const completedCount = steps.filter((step) => step.done).length;

  return (
    <Card className="panel onboarding-card stack-md">
      <div className="onboarding-header">
        <div className="stack-xs">
          <h2 className="onboarding-title">Finish setting up Irulan</h2>
          <p className="onboarding-subtitle">
            {completedCount} of {steps.length} done
          </p>
        </div>
        <Button
          className="onboarding-dismiss"
          onClick={onDismiss}
          size="sm"
          type="button"
          variant="ghost"
        >
          Hide
        </Button>
      </div>

      <ol className="smtp-onboarding-steps">
        {steps.map((step, index) => (
          <li
            className={cn("smtp-onboarding-step", step.done && "onboarding-step-done")}
            key={step.id}
          >
            <span
              aria-hidden="true"
              className={cn(
                "smtp-onboarding-step-number",
                step.done && "onboarding-step-number-done",
              )}
            >
              {step.done ? <CheckIcon /> : index + 1}
            </span>
            <div className="stack-xs">
              <div className="smtp-onboarding-step-heading">
                <p className="smtp-onboarding-step-title">{step.title}</p>
                <Badge
                  className={cn("status-pill", step.done ? "status-sent" : "status-pending")}
                  variant={getStatusBadgeVariant(step.done ? "configured" : "pending")}
                >
                  {step.done ? "Done" : "To do"}
                </Badge>
              </div>
              <p className="smtp-onboarding-step-copy">{step.description}</p>
              {!step.done ? (
                <div className="onboarding-step-action">
                  <Button
                    disabled={step.actionDisabled}
                    onClick={step.onAction}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {step.actionLabel}
                  </Button>
                </div>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
};

