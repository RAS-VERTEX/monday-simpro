// pages/api/admin/check-deals-board.ts
import { NextApiRequest, NextApiResponse } from "next";
import { MondayApi } from "@/lib/clients/monday/monday-api";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    const mondayApi = new MondayApi(process.env.MONDAY_API_TOKEN!);
    const boardId = process.env.MONDAY_DEALS_BOARD_ID!;

    // Simple query to get board info
    const query = `
      query {
        boards(ids: [${boardId}]) {
          name
          columns {
            id
            title
            type
            settings_str
          }
          items_page(limit: 3) {
            items {
              id
              name
              column_values {
                id
                title
                text
              }
            }
          }
        }
      }
    `;

    const result = await mondayApi.query(query);
    const board = result.boards[0];

    // Find status columns
    const statusColumns = board.columns.filter(
      (col: any) =>
        col.type === "color" || col.title.toLowerCase().includes("stage")
    );

    // Parse status options
    const statusInfo = statusColumns.map((col: any) => {
      let options = {};
      if (col.settings_str) {
        try {
          const settings = JSON.parse(col.settings_str);
          options = settings.labels || {};
        } catch (e) {
          options = { error: "Could not parse" };
        }
      }
      return {
        id: col.id,
        title: col.title,
        options: options,
      };
    });

    // Get current status values from items
    const itemStatusValues = board.items_page.items.map((item: any) => {
      const statusCol = statusColumns[0]; // Get first status column
      const statusValue = item.column_values.find(
        (cv: any) => cv.id === statusCol?.id
      );
      return {
        itemName: item.name,
        statusValue: statusValue?.text || "No status",
      };
    });

    return res.status(200).json({
      SUCCESS: true,
      BOARD_NAME: board.name,
      BOARD_ID: boardId,

      STATUS_COLUMNS_FOUND: statusInfo,

      CURRENT_CONFIG_SAYS: "deal_stage",
      WEBHOOK_TRIES_TO_USE: "color_mktrw6k3",

      CURRENT_STATUS_VALUES_IN_ITEMS: itemStatusValues,

      ALL_COLUMNS: board.columns.map((col: any) => ({
        id: col.id,
        title: col.title,
        type: col.type,
      })),

      DIAGNOSIS: {
        problem: "Webhook uses wrong column ID",
        currentlyUsing: "color_mktrw6k3",
        shouldUse: statusInfo[0]?.id || "NOT_FOUND",
        statusColumnExists: statusInfo.length > 0,
      },
    });
  } catch (error) {
    return res.status(500).json({
      ERROR: true,
      message: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
}
