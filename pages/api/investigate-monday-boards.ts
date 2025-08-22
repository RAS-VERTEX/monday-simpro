// pages/api/investigate-monday-boards.ts
import { NextApiRequest, NextApiResponse } from "next";
import { MondayApi } from "@/lib/clients/monday/monday-api";

interface BoardColumn {
  id: string;
  title: string;
  type: string;
  settings_str?: string;
  description?: string;
}

interface BoardItem {
  id: string;
  name: string;
  column_values: Array<{
    id: string;
    text: string;
    value?: string;
  }>;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const mondayApi = new MondayApi(process.env.MONDAY_API_TOKEN!);

    // Get all board IDs from environment
    const accountsBoardId = process.env.MONDAY_ACCOUNTS_BOARD_ID!;
    const contactsBoardId = process.env.MONDAY_CONTACTS_BOARD_ID!;
    const dealsBoardId = process.env.MONDAY_DEALS_BOARD_ID!;

    console.log("🔍 Investigating Monday boards...");

    // Comprehensive query to get all board information
    const query = `
      query InvestigateBoards($accountsId: ID!, $contactsId: ID!, $dealsId: ID!) {
        accounts: boards(ids: [$accountsId]) {
          id
          name
          description
          columns {
            id
            title
            type
            description
            settings_str
          }
          items_page(limit: 3) {
            items {
              id
              name
              column_values {
                id
                text
                value
              }
            }
          }
        }
        contacts: boards(ids: [$contactsId]) {
          id
          name
          description
          columns {
            id
            title
            type
            description
            settings_str
          }
          items_page(limit: 3) {
            items {
              id
              name
              column_values {
                id
                text
                value
              }
            }
          }
        }
        deals: boards(ids: [$dealsId]) {
          id
          name
          description
          columns {
            id
            title
            type
            description
            settings_str
          }
          items_page(limit: 3) {
            items {
              id
              name
              column_values {
                id
                text
                value
              }
            }
          }
        }
      }
    `;

    const result = await mondayApi.query(query, {
      accountsId: accountsBoardId,
      contactsId: contactsBoardId,
      dealsId: dealsBoardId,
    });

    // Helper function to analyze columns
    function analyzeColumns(columns: BoardColumn[]) {
      const analysis = {
        statusColumns: [] as any[],
        relationColumns: [] as any[],
        textColumns: [] as any[],
        numberColumns: [] as any[],
        dateColumns: [] as any[],
        peopleColumns: [] as any[],
        otherColumns: [] as any[],
      };

      columns.forEach((col) => {
        const columnInfo = {
          id: col.id,
          title: col.title,
          type: col.type,
          description: col.description,
        };

        // Parse settings for status columns
        if (col.type === "color" && col.settings_str) {
          try {
            const settings = JSON.parse(col.settings_str);
            (columnInfo as any).statusOptions = settings.labels || {};
            analysis.statusColumns.push(columnInfo);
          } catch (e) {
            analysis.statusColumns.push({
              ...columnInfo,
              statusOptions: { error: "Could not parse settings" },
            });
          }
        } else if (col.type === "board-relation") {
          analysis.relationColumns.push(columnInfo);
        } else if (col.type === "text" || col.type === "long-text") {
          analysis.textColumns.push(columnInfo);
        } else if (col.type === "numbers") {
          analysis.numberColumns.push(columnInfo);
        } else if (col.type === "date") {
          analysis.dateColumns.push(columnInfo);
        } else if (col.type === "multiple-person") {
          analysis.peopleColumns.push(columnInfo);
        } else {
          analysis.otherColumns.push(columnInfo);
        }
      });

      return analysis;
    }

    // Helper function to get current column values from items
    function getCurrentValues(
      items: BoardItem[],
      columnId: string,
      columns: BoardColumn[]
    ) {
      // Get the column title for reference
      const column = columns.find((col) => col.id === columnId);
      const columnTitle = column?.title || "Unknown Column";

      return items
        .map((item) => {
          const columnValue = item.column_values.find(
            (cv) => cv.id === columnId
          );
          return {
            itemName: item.name,
            value: columnValue?.text || "No value",
            rawValue: columnValue?.value || null,
            columnTitle,
          };
        })
        .filter((item) => item.value !== "No value");
    }

    // Analyze each board
    const accountsBoard = result.accounts[0];
    const contactsBoard = result.contacts[0];
    const dealsBoard = result.deals[0];

    const investigation = {
      timestamp: new Date().toISOString(),
      environment: {
        accountsBoardId,
        contactsBoardId,
        dealsBoardId,
      },

      // ACCOUNTS BOARD ANALYSIS
      accountsBoard: {
        id: accountsBoard.id,
        name: accountsBoard.name,
        description: accountsBoard.description,
        columnAnalysis: analyzeColumns(accountsBoard.columns),
        totalColumns: accountsBoard.columns.length,
        itemCount: accountsBoard.items_page.items.length,
        sampleItems: accountsBoard.items_page.items.map((item) => ({
          id: item.id,
          name: item.name,
        })),
      },

      // CONTACTS BOARD ANALYSIS
      contactsBoard: {
        id: contactsBoard.id,
        name: contactsBoard.name,
        description: contactsBoard.description,
        columnAnalysis: analyzeColumns(contactsBoard.columns),
        totalColumns: contactsBoard.columns.length,
        itemCount: contactsBoard.items_page.items.length,
        sampleItems: contactsBoard.items_page.items.map((item) => ({
          id: item.id,
          name: item.name,
        })),
      },

      // DEALS BOARD ANALYSIS (Most important for the current issue)
      dealsBoard: {
        id: dealsBoard.id,
        name: dealsBoard.name,
        description: dealsBoard.description,
        columnAnalysis: analyzeColumns(dealsBoard.columns),
        totalColumns: dealsBoard.columns.length,
        itemCount: dealsBoard.items_page.items.length,
        sampleItems: dealsBoard.items_page.items.map((item) => ({
          id: item.id,
          name: item.name,
        })),
      },

      // CRITICAL ISSUE DIAGNOSIS
      dealsBoardDiagnosis: {
        statusColumns: analyzeColumns(dealsBoard.columns).statusColumns,
        currentConfigUsing: "deal_stage",
        actualStatusColumnId:
          analyzeColumns(dealsBoard.columns).statusColumns[0]?.id ||
          "NOT_FOUND",
        statusOptionsAvailable:
          analyzeColumns(dealsBoard.columns).statusColumns[0]?.statusOptions ||
          {},

        // Check what status values exist in current items
        currentStatusValues: analyzeColumns(dealsBoard.columns).statusColumns[0]
          ? getCurrentValues(
              dealsBoard.items_page.items,
              analyzeColumns(dealsBoard.columns).statusColumns[0].id,
              dealsBoard.columns
            )
          : [],

        // Configuration recommendations
        recommendedFix: {
          changeInConfig: {
            from: "stage: 'deal_stage'",
            to: `stage: '${
              analyzeColumns(dealsBoard.columns).statusColumns[0]?.id ||
              "COLUMN_NOT_FOUND"
            }'`,
          },
          statusFormat:
            "Determine if needs { label: 'Status' } or { index: 0 }",
          testCommand: "Test with a small quote after making this change",
        },
      },

      // COLUMN MAPPING SUGGESTIONS
      suggestedColumnMappings: {
        accounts: {
          current: {
            description: "dropdown_mktjs43t",
            notes: "text_mktqry14",
          },
          suggested: accountsBoard.columns.reduce((acc, col) => {
            if (col.type === "dropdown") acc.description = col.id;
            if (col.type === "text" && col.title.toLowerCase().includes("note"))
              acc.notes = col.id;
            return acc;
          }, {} as any),
        },
        contacts: {
          current: {
            email: "contact_email",
            phone: "contact_phone",
            notes: "text_mktqzy0q",
          },
          suggested: contactsBoard.columns.reduce((acc, col) => {
            if (col.type === "email") acc.email = col.id;
            if (col.type === "phone") acc.phone = col.id;
            if (col.type === "text" && col.title.toLowerCase().includes("note"))
              acc.notes = col.id;
            return acc;
          }, {} as any),
        },
        deals: {
          current: {
            value: "deal_value",
            stage: "deal_stage", // ← PROBLEM IS HERE
            close_date: "deal_expected_close_date",
            notes: "text_mktq93t9",
            owner: "deal_owner",
          },
          suggested: dealsBoard.columns.reduce((acc, col) => {
            if (
              col.type === "numbers" &&
              col.title.toLowerCase().includes("value")
            )
              acc.value = col.id;
            if (col.type === "color") acc.stage = col.id; // ← CRITICAL FIX
            if (
              col.type === "date" &&
              col.title.toLowerCase().includes("close")
            )
              acc.close_date = col.id;
            if (col.type === "text" && col.title.toLowerCase().includes("note"))
              acc.notes = col.id;
            if (col.type === "multiple-person") acc.owner = col.id;
            return acc;
          }, {} as any),
        },
      },

      // ALL COLUMNS FOR REFERENCE
      allColumns: {
        accounts: accountsBoard.columns,
        contacts: contactsBoard.columns,
        deals: dealsBoard.columns,
      },
    };

    console.log("✅ Investigation complete");

    return res.status(200).json({
      success: true,
      investigation,

      // Quick summary for immediate action
      quickFix: {
        problem: "Wrong column ID for deals status/stage",
        currentlyUsing: "deal_stage",
        shouldUse: investigation.dealsBoardDiagnosis.actualStatusColumnId,
        fixLocation: "lib/clients/monday/monday-config.ts",
        urgency: "HIGH - Blocking all deal creation",
      },
    });
  } catch (error) {
    console.error("❌ Investigation failed:", error);

    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
      timestamp: new Date().toISOString(),
    });
  }
}
