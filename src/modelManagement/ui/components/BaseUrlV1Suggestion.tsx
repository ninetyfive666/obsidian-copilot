import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AlertTriangle } from "lucide-react";
import React from "react";

export interface BaseUrlV1SuggestionProps {
  suggestedBaseUrl: string;
  onApply: (baseUrl: string) => void;
}

export const BaseUrlV1Suggestion: React.FC<BaseUrlV1SuggestionProps> = ({
  suggestedBaseUrl,
  onApply,
}) => {
  return (
    <div
      className={cn(
        "tw-flex tw-flex-wrap tw-items-center tw-gap-2 tw-rounded-lg tw-border tw-border-solid tw-border-warning/40",
        "tw-bg-secondary tw-px-3 tw-py-2.5 tw-text-xs tw-text-normal"
      )}
      role="alert"
    >
      <AlertTriangle
        className={cn("tw-mt-0.5 tw-size-4 tw-shrink-0 tw-text-warning")}
        aria-hidden="true"
      />
      <span className="tw-min-w-0 tw-flex-1">
        <strong>The model list works, but the chat API is only served under /v1.</strong> Without
        it, chat and agent requests fail with 404.
      </span>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => onApply(suggestedBaseUrl)}
        aria-label={`Use Base URL ${suggestedBaseUrl}`}
      >
        Use {suggestedBaseUrl}
      </Button>
    </div>
  );
};
