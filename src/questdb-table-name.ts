export const buildQuestDbTableName = (
  tablePrefix: string,
  dataGroup: string | null | undefined,
  suffix: "_data" | "_table",
): string => {
  const group = dataGroup ? `_${dataGroup}` : "";
  return `${tablePrefix}${group}${suffix}`;
};
