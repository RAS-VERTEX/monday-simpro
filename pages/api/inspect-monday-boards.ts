// pages/api/inspect-monday-boards.ts - Simplified board inspection
import { NextApiRequest, NextApiResponse } from "next";
import { MondayClient } from "@/lib/monday-client";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const mondayClient = new MondayClient({
      apiToken: process.env.MONDAY_API_TOKEN!,
    });

    const boardIds = {
      accounts: process.env.MONDAY_ACCOUNTS_BOARD_ID!,
      contacts: process.env.MONDAY_CONTACTS_BOARD_ID!,
      deals: process.env.MONDAY_DEALS_BOARD_ID!,
    };

    console.log("🔍 [Board Inspector] Inspecting Monday boards one by one...");

    const results: any = {
      timestamp: new Date().toISOString(),
      boardIds,
      boards: {},
    };

    // Simple query for board columns only (no items to avoid complexity)
    const getColumnsQuery = `
      query GetBoardColumns($boardId: ID!) {
        boards(ids: [$boardId]) {
          id
          name
          description
          columns {
            id
            title
            type
          }
        }
      }
    `;

    // Simple query for sample items only
    const getSampleItemsQuery = `
      query GetSampleItems($boardId: ID!) {
        boards(ids: [$boardId]) {
          items_page(limit: 2) {
            items {
              id
              name
              column_values {
                id
                type
                text
                value
              }
            }
          }
        }
      }
    `;

    // Inspect each board separately
    for (const [boardType, boardId] of Object.entries(boardIds)) {
      try {
        console.log(
          `📋 [Board Inspector] Inspecting ${boardType} board: ${boardId}`
        );

        // Get columns
        const columnsData = await mondayClient.query(getColumnsQuery, {
          boardId,
        });
        const board = columnsData.boards[0];

        if (!board) {
          results.boards[boardType] = { error: `Board ${boardId} not found` };
          continue;
        }

        // Get sample items
        let sampleItems = [];
        try {
          const itemsData = await mondayClient.query(getSampleItemsQuery, {
            boardId,
          });
          sampleItems = itemsData.boards[0]?.items_page?.items || [];
        } catch (error) {
          console.log(
            `⚠️ Could not fetch sample items for ${boardType}: ${error}`
          );
        }

        results.boards[boardType] = {
          id: board.id,
          name: board.name,
          description: board.description,
          columns: board.columns.map((col: any) => ({
            id: col.id,
            title: col.title,
            type: col.type,
          })),
          sampleItems: sampleItems.map((item: any) => ({
            id: item.id,
            name: item.name,
            columnValues: item.column_values.map((cv: any) => ({
              columnId: cv.id,
              type: cv.type,
              text: cv.text,
              value: cv.value,
            })),
          })),
        };

        console.log(
          `✅ [Board Inspector] ${boardType} board inspected: ${board.columns.length} columns found`
        );
      } catch (error) {
        console.error(
          `❌ [Board Inspector] Error inspecting ${boardType} board:`,
          error
        );
        results.boards[boardType] = {
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }

    // Generate recommended column mapping
    const generateColumnMapping = () => {
      const mapping: any = {
        accounts: {},
        contacts: {},
        deals: {},
      };

      // Accounts mapping
      const accountsBoard = results.boards.accounts;
      if (accountsBoard.columns) {
        accountsBoard.columns.forEach((col: any) => {
          const title = col.title.toLowerCase();
          const type = col.type;

          console.log(
            `🔍 Accounts column: ${col.id} - "${col.title}" (${type})`
          );

          if (title.includes("industry") || title.includes("type")) {
            mapping.accounts.industry = col.id;
          } else if (
            title.includes("description") ||
            (type === "long_text" && !title.includes("note"))
          ) {
            mapping.accounts.description = col.id;
          } else if (title.includes("note") && type === "long_text") {
            mapping.accounts.notes = col.id;
          } else if (
            (title.includes("contact") || title.includes("people")) &&
            type === "connect_boards"
          ) {
            mapping.accounts.contacts_relation = col.id;
          } else if (
            (title.includes("deal") || title.includes("opportunity")) &&
            type === "connect_boards"
          ) {
            mapping.accounts.deals_relation = col.id;
          }
        });
      }

      // Contacts mapping
      const contactsBoard = results.boards.contacts;
      if (contactsBoard.columns) {
        contactsBoard.columns.forEach((col: any) => {
          const title = col.title.toLowerCase();
          const type = col.type;

          console.log(
            `🔍 Contacts column: ${col.id} - "${col.title}" (${type})`
          );

          if (type === "email") {
            mapping.contacts.email = col.id;
          } else if (type === "phone") {
            mapping.contacts.phone = col.id;
          } else if (title.includes("note") && type === "long_text") {
            mapping.contacts.notes = col.id;
          } else if (
            (title.includes("account") || title.includes("company")) &&
            type === "connect_boards"
          ) {
            mapping.contacts.accounts_relation = col.id;
          } else if (
            (title.includes("deal") || title.includes("opportunity")) &&
            type === "connect_boards"
          ) {
            mapping.contacts.deals_relation = col.id;
          }
        });
      }

      // Deals mapping
      const dealsBoard = results.boards.deals;
      if (dealsBoard.columns) {
        dealsBoard.columns.forEach((col: any) => {
          const title = col.title.toLowerCase();
          const type = col.type;

          console.log(`🔍 Deals column: ${col.id} - "${col.title}" (${type})`);

          if (
            type === "numbers" &&
            (title.includes("value") ||
              title.includes("amount") ||
              title.includes("price"))
          ) {
            mapping.deals.value = col.id;
          } else if (type === "color" || type === "status") {
            mapping.deals.stage = col.id;
          } else if (
            type === "date" &&
            (title.includes("close") ||
              title.includes("due") ||
              title.includes("end"))
          ) {
            mapping.deals.close_date = col.id;
          } else if (title.includes("note") && type === "long_text") {
            mapping.deals.notes = col.id;
          } else if (
            (title.includes("contact") || title.includes("people")) &&
            type === "connect_boards"
          ) {
            mapping.deals.contacts_relation = col.id;
          } else if (
            (title.includes("account") || title.includes("company")) &&
            type === "connect_boards"
          ) {
            mapping.deals.accounts_relation = col.id;
          }
        });
      }

      return mapping;
    };

    const recommendedMapping = generateColumnMapping();

    console.log("✅ [Board Inspector] Board inspection completed successfully");

    // Create the updated config code
    const configCode = `
// Updated MONDAY_COLUMN_IDS based on your actual board structure
export const MONDAY_COLUMN_IDS: MondayColumnIds = {
  accounts: {
    description: "${recommendedMapping.accounts.description || "long_text"}",
    notes: "${recommendedMapping.accounts.notes || "long_text__1"}",
    contacts_relation: "${
      recommendedMapping.accounts.contacts_relation || "connect_boards"
    }",
    deals_relation: "${
      recommendedMapping.accounts.deals_relation || "connect_boards5"
    }",
  },
  contacts: {
    email: "${recommendedMapping.contacts.email || "email"}",
    phone: "${recommendedMapping.contacts.phone || "phone"}",
    notes: "${recommendedMapping.contacts.notes || "long_text"}",
    accounts_relation: "${
      recommendedMapping.contacts.accounts_relation || "connect_boards"
    }",
    deals_relation: "${
      recommendedMapping.contacts.deals_relation || "connect_boards4"
    }",
  },
  deals: {
    value: "${recommendedMapping.deals.value || "numbers"}",
    stage: "${recommendedMapping.deals.stage || "status"}",
    close_date: "${recommendedMapping.deals.close_date || "date4"}",
    notes: "${recommendedMapping.deals.notes || "long_text"}",
    contacts_relation: "${
      recommendedMapping.deals.contacts_relation || "connect_boards"
    }",
    accounts_relation: "${
      recommendedMapping.deals.accounts_relation || "connect_boards9"
    }",
  },
};
    `;

    res.status(200).json({
      success: true,
      message: "Monday board structure inspection completed",
      ...results,
      recommendedMapping,
      configCode: configCode.trim(),
      instructions: {
        message:
          "Copy the configCode and replace MONDAY_COLUMN_IDS in lib/clients/monday/monday-config.ts",
        steps: [
          "1. Review the 'boards' data to verify column mappings",
          "2. Copy the 'configCode' section",
          "3. Replace MONDAY_COLUMN_IDS in lib/clients/monday/monday-config.ts",
          "4. Test the sync again with proper column IDs",
        ],
      },
    });
  } catch (error) {
    console.error("[Board Inspector] Critical error:", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
      message: "Failed to inspect Monday board structure",
    });
  }
}
