import { Response } from "express";
import { AdageData, AnyValue } from "../types/adage.type";
import { DatasetMetadata } from "../types/db.type";

export function assertDatasetExists(
  res: Response,
  dataset: AdageData | DatasetMetadata | null,
): boolean {
  if (!dataset) {
    res.status(404).json({
      error: "DATASET_NOT_FOUND",
      message: `Invalid dataset id.`,
    });

    return false;
  }

  return true;
}

export function assertDatasetCount(res: Response, count: number): boolean {
  if (count <= 0) {
    res.status(404).json({
      error: "DATASET_NOT_FOUND",
      message: `Invalid dataset id.`,
    });
    return false;
  }

  return true;
}

export function assertChartCount(res: Response, deleted: boolean): boolean {
  if (!deleted) {
    res.status(404).json({
      error: "CHART_NOT_FOUND",
      message: `Invalid chart id.`,
    });
    return false;
  }

  return true;
}

export function assertValidParam(
  res: Response,
  field: string,
  value: AnyValue,
): boolean {
  if (!value || typeof value !== "string") {
    res.status(400).json({
      error: "INVALID_PARAMETERS",
      message: `Invalid request parameter: ${field}.`,
    });

    return false;
  }

  return true;
}