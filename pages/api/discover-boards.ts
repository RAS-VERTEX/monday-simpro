// pages/api/discover-boards.ts
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
      query GetBoardStructures {
        boards(ids: [${process.env.MONDAY_CONTACTS_BOARD_ID!}, ${process.env
      .MONDAY_ACCOUNTS_BOARD_ID!}, ${process.env.MONDAY_DEALS_BOARD_ID!}]) {
          id
          name
          description
          type
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
                text
                value
                type
              }
            }
          }
        }
      }
    `;

    const response = await fetch("https://api.monday.com/v2", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: process.env.MONDAY_API_TOKEN!,
      },
      body: JSON.stringify({ query }),
    });

    const result = await response.json();

    if (result.errors) {
      throw new Error(`Monday API Error: ${result.errors[0].message}`);
    }

    const boards = result.data?.boards || [];

    console.log("\n🎯 MONDAY BOARD DISCOVERY RESULTS");
    console.log("==================================");

    boards.forEach((board, boardIndex) => {
      console.log(`\n📋 BOARD ${boardIndex + 1}: ${board.name} (${board.id})`);
      console.log("=" + "=".repeat(board.name.length + 20));

      console.log("\nCOLUMNS:");
      console.log("--------");
      board.columns.forEach((col) => {
        console.log(
          `${col.id.padEnd(20)} | ${col.type.padEnd(15)} | ${col.title}`
        );
      });

      console.log("\nTEXT COLUMNS (Potential SimPro ID):");
      console.log("-----------------------------------");
      const textColumns = board.columns.filter((col) => col.type === "text");
      textColumns.forEach((col) => {
        console.log(`${col.id.padEnd(20)} | ${col.title}`);
      });

      console.log("\nSAMPLE DATA:");
      console.log("------------");
      const sampleItems = board.items_page?.items || [];

      sampleItems.forEach((item, index) => {
        console.log(`\n  Contact ${index + 1}: ${item.name}`);

        // Show only text columns with actual data
        const textColumnsWithData = item.column_values.filter(
          (cv) =>
            cv.text &&
            cv.text.trim() &&
            textColumns.some((tc) => tc.id === cv.id)
        );

        textColumnsWithData.forEach((cv) => {
          const column = board.columns.find((c) => c.id === cv.id);
          console.log(
            `    ${cv.id.padEnd(18)} | ${cv.text.padEnd(12)} | ${
              column?.title || "Unknown"
            }`
          );
        });
      });

      // Look for SimPro ID patterns
      console.log("\nNUMERIC COLUMNS (Likely SimPro IDs):");
      console.log("------------------------------------");
      const numericColumns = [];
      textColumns.forEach((col) => {
        const hasNumericData = sampleItems.some((item) => {
          const cv = item.column_values.find((cv) => cv.id === col.id);
          return cv?.text && /^\d+$/.test(cv.text.trim());
        });

        if (hasNumericData) {
          numericColumns.push(col);
          console.log(`${col.id.padEnd(20)} | ${col.title}`);

          // Show sample values
          sampleItems.forEach((item) => {
            const cv = item.column_values.find((cv) => cv.id === col.id);
            if (cv?.text && /^\d+$/.test(cv.text.trim())) {
              console.log(`  └─ ${item.name}: ${cv.text}`);
            }
          });
        }
      });

      if (numericColumns.length === 0) {
        console.log("  No columns with numeric data found");
      }
    });

    console.log("\n✅ RECOMMENDED COLUMN MAPPING:");
    console.log("==============================");

    const contactsBoard = boards.find(
      (b) => b.id === process.env.MONDAY_CONTACTS_BOARD_ID
    );
    const accountsBoard = boards.find(
      (b) => b.id === process.env.MONDAY_ACCOUNTS_BOARD_ID
    );
    const dealsBoard = boards.find(
      (b) => b.id === process.env.MONDAY_DEALS_BOARD_ID
    );

    if (contactsBoard) {
      const contactSimProColumn = contactsBoard.columns.find(
        (col) =>
          col.type === "text" &&
          (col.title?.toLowerCase().includes("simpro") ||
            col.title?.toLowerCase().includes("id"))
      );
      console.log(
        `Contacts SimPro ID: "${contactSimProColumn?.id || "NOT_FOUND"}" (${
          contactSimProColumn?.title || "No title"
        })`
      );
    }

    if (accountsBoard) {
      const accountSimProColumn = accountsBoard.columns.find(
        (col) =>
          col.type === "text" &&
          (col.title?.toLowerCase().includes("simpro") ||
            col.title?.toLowerCase().includes("id"))
      );
      console.log(
        `Accounts SimPro ID: "${accountSimProColumn?.id || "NOT_FOUND"}" (${
          accountSimProColumn?.title || "No title"
        })`
      );
    }

    if (dealsBoard) {
      const dealSimProColumn = dealsBoard.columns.find(
        (col) =>
          col.type === "text" &&
          (col.title?.toLowerCase().includes("simpro") ||
            col.title?.toLowerCase().includes("id"))
      );
      console.log(
        `Deals SimPro ID: "${dealSimProColumn?.id || "NOT_FOUND"}" (${
          dealSimProColumn?.title || "No title"
        })`
      );
    }

    res.status(200).json({
      success: true,
      message: "Board structure logged to console - check your terminal/logs",
      boards: boards.map((b) => ({
        id: b.id,
        name: b.name,
        type: b.type,
        columnCount: b.columns.length,
        textColumnCount: b.columns.filter((c) => c.type === "text").length,
      })),
    });
  } catch (error) {
    console.error("❌ Board discovery error:", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
