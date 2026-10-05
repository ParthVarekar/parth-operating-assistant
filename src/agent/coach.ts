import type { ScheduledPlan } from "../planner/intervalScheduler.js";

/**
 * Formats a scheduled plan into a crisp, readable Telegram markdown card.
 * @param plan The calculated plan.
 * @returns Markdown formatted schedule message.
 */
export function formatPlanMessage(plan: ScheduledPlan): string {
  if (plan.blocks.length === 0) {
    return "🌙 **No active tasks scheduled for tonight.**\nYour dinner and sleep slots are protected. Rest or add a task when ready.";
  }

  const lines: string[] = ["📅 **Tonight's Operating Plan:**\n"];

  for (const block of plan.blocks) {
    const icon = block.zoneType === "deep_work" ? "⚡" : "🔹";
    lines.push(`${icon} \`${block.startTime} – ${block.endTime}\`: **${block.taskTitle}**`);
  }

  lines.push(`\n🍽️ \`21:30 – 22:30\`: **Dinner Anchor (Protected)**`);
  lines.push(`🛌 \`04:30\`: **Target Sleep Boundary**`);

  if (plan.deferredTasks.length > 0) {
    lines.push(`\n⏭️ **Deferred to Tomorrow (Protected Sleep):**`);
    for (const def of plan.deferredTasks) {
      lines.push(`• ${def.title} (${def.estimatedMinutes}m)`);
    }
  }

  return lines.join("\n");
}

/**
 * Formats an alert when a task runs over or slips.
 * @param explanation Explanatory text from replan engine.
 * @param plan The recalculated plan.
 * @returns Formatted message.
 */
export function formatReplanNotice(explanation: string, plan: ScheduledPlan): string {
  const planText = formatPlanMessage(plan);
  return `⚠️ **Schedule Recalibrated**\n${explanation}\n\n${planText}`;
}

/**
 * Generates proactive post-college arrival check-in message.
 * @returns Proactive greeting.
 */
export function generateTroughCheckin(): string {
  return (
    `👋 **Back from college.**\n\n` +
    `You have a 2-hour window before dinner at 9:30 PM. ` +
    `Don't dive into heavy coding right now—stamina is low.\n\n` +
    `Recommended: Unpack, review any printable submissions, and have a quick snack.`
  );
}
