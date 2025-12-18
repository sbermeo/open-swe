export const MODEL_OPTIONS = [
  // TODO: Test these then re-enable
  // {
  //   label: "Claude Sonnet 4 (Extended Thinking)",
  //   value: "anthropic:extended-thinking:claude-sonnet-4-0",
  // },
  {
  ];

export const MODEL_OPTIONS_NO_THINKING = MODEL_OPTIONS.filter(
  ({ value }) =>
    !value.includes("extended-thinking") || !value.startsWith("openai:o"),
);
