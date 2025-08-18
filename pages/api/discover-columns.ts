// pages/api/discover-columns.ts - Find the SimPro ID column IDs
import { NextApiRequest, NextApiResponse } from "next";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const query = `
      query {
        boards(ids: [
          "${process.env.MONDAY_ACCOUNTS_BOARD_ID}",
          "${process.env.MONDAY_CONTACTS_BOARD_ID}",
          "${process.env.MONDAY_DEALS_BOARD_ID}"
        ]) {
          id
          name
          columns {
            id
            title
            type
          }
        }
      }
    `;

    const response = await fetch("https://api.monday.com/v2", {
      method: "POST",
      headers: {
        Authorization: process.env.MONDAY_API_TOKEN!,
        "Content-Type": "application/json",
        "API-Version": "2024-04",
      },
      body: JSON.stringify({ query }),
    });

    const result = await response.json();

    if (result.errors) {
      throw new Error(
        `Monday API errors: ${result.errors
          .map((e: any) => e.message)
          .join(", ")}`
      );
    }

    // Find SimPro ID columns
    const boardsWithSimProColumns = result.data.boards.map((board: any) => {
      const simproIdColumn = board.columns.find(
        (col: any) => col.title === "SimPro ID" && col.type === "text"
      );

      return {
        boardId: board.id,
        boardName: board.name,
        simproIdColumn: simproIdColumn
          ? {
              id: simproIdColumn.id,
              title: simproIdColumn.title,
              type: simproIdColumn.type,
            }
          : null,
        allColumns: board.columns,
      };
    });

    res.status(200).json({
      success: true,
      message: "Board column discovery complete",
      boards: boardsWithSimProColumns,
      instructions:
        "Look for the 'simproIdColumn' field in each board to find your SimPro ID column IDs",
    });
  } catch (error) {
    console.error("Column discovery failed:", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
