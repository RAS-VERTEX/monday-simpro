// pages/api/test-monday-formats.ts - Test exact column formats Monday expects
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
      contacts: process.env.MONDAY_CONTACTS_BOARD_ID!,
      deals: process.env.MONDAY_DEALS_BOARD_ID!,
    };

    console.log("🧪 [Format Tester] Testing Monday column formats...");

    const results: any = {
      timestamp: new Date().toISOString(),
      tests: [],
    };

    // Test 1: Email column format
    console.log("📧 Testing email column format...");
    try {
      const emailTest = await mondayClient.createItem(
        boardIds.contacts,
        "TEST Email Format",
        {
          contact_email: "test@example.com", // Simple string
        }
      );
      results.tests.push({
        test: "Email - Simple String",
        column: "contact_email",
        value: "test@example.com",
        result: "SUCCESS",
        itemId: emailTest.id,
      });
    } catch (error) {
      results.tests.push({
        test: "Email - Simple String",
        column: "contact_email",
        value: "test@example.com",
        result: "FAILED",
        error: error instanceof Error ? error.message : "Unknown error",
      });

      // Try email object format
      try {
        const emailTest2 = await mondayClient.createItem(
          boardIds.contacts,
          "TEST Email Object",
          {
            contact_email: {
              email: "test2@example.com",
              text: "test2@example.com",
            },
          }
        );
        results.tests.push({
          test: "Email - Object Format",
          column: "contact_email",
          value: { email: "test2@example.com", text: "test2@example.com" },
          result: "SUCCESS",
          itemId: emailTest2.id,
        });
      } catch (error2) {
        results.tests.push({
          test: "Email - Object Format",
          column: "contact_email",
          value: { email: "test2@example.com", text: "test2@example.com" },
          result: "FAILED",
          error: error2 instanceof Error ? error2.message : "Unknown error",
        });
      }
    }

    // Test 2: Phone column format
    console.log("📞 Testing phone column format...");
    try {
      const phoneTest = await mondayClient.createItem(
        boardIds.contacts,
        "TEST Phone Format",
        {
          contact_phone: "0416615234", // Simple string
        }
      );
      results.tests.push({
        test: "Phone - Simple String",
        column: "contact_phone",
        value: "0416615234",
        result: "SUCCESS",
        itemId: phoneTest.id,
      });
    } catch (error) {
      results.tests.push({
        test: "Phone - Simple String",
        column: "contact_phone",
        value: "0416615234",
        result: "FAILED",
        error: error instanceof Error ? error.message : "Unknown error",
      });

      // Try phone object format
      try {
        const phoneTest2 = await mondayClient.createItem(
          boardIds.contacts,
          "TEST Phone Object",
          {
            contact_phone: { phone: "0416615234", countryShortName: "AU" },
          }
        );
        results.tests.push({
          test: "Phone - Object Format",
          column: "contact_phone",
          value: { phone: "0416615234", countryShortName: "AU" },
          result: "SUCCESS",
          itemId: phoneTest2.id,
        });
      } catch (error2) {
        results.tests.push({
          test: "Phone - Object Format",
          column: "contact_phone",
          value: { phone: "0416615234", countryShortName: "AU" },
          result: "FAILED",
          error: error2 instanceof Error ? error2.message : "Unknown error",
        });
      }
    }

    // Test 3: Board relation format
    console.log("🔗 Testing board relation format...");

    // First create a test account to link to
    let testAccountId: string;
    try {
      const testAccount = await mondayClient.createItem(
        process.env.MONDAY_ACCOUNTS_BOARD_ID!,
        "TEST Account for Relation",
        {}
      );
      testAccountId = testAccount.id;

      const relationTest = await mondayClient.createItem(
        boardIds.contacts,
        "TEST Board Relation",
        {
          contact_account: { item_ids: [parseInt(testAccountId)] },
        }
      );
      results.tests.push({
        test: "Board Relation - item_ids Array",
        column: "contact_account",
        value: { item_ids: [parseInt(testAccountId)] },
        result: "SUCCESS",
        itemId: relationTest.id,
        linkedAccountId: testAccountId,
      });
    } catch (error) {
      results.tests.push({
        test: "Board Relation - item_ids Array",
        column: "contact_account",
        value: { item_ids: ["test"] },
        result: "FAILED",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }

    // Test 4: Numbers column format
    console.log("💰 Testing numbers column format...");
    try {
      const numbersTest = await mondayClient.createItem(
        boardIds.deals,
        "TEST Numbers Format",
        {
          deal_value: 25000, // Simple number
        }
      );
      results.tests.push({
        test: "Numbers - Simple Number",
        column: "deal_value",
        value: 25000,
        result: "SUCCESS",
        itemId: numbersTest.id,
      });
    } catch (error) {
      results.tests.push({
        test: "Numbers - Simple Number",
        column: "deal_value",
        value: 25000,
        result: "FAILED",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }

    // Test 5: Status column format
    console.log("📊 Testing status column format...");
    try {
      const statusTest = await mondayClient.createItem(
        boardIds.deals,
        "TEST Status Format",
        {
          color_mktrw6k3: { label: "Working on it" }, // Object with label
        }
      );
      results.tests.push({
        test: "Status - Label Object",
        column: "color_mktrw6k3",
        value: { label: "Working on it" },
        result: "SUCCESS",
        itemId: statusTest.id,
      });
    } catch (error) {
      results.tests.push({
        test: "Status - Label Object",
        column: "color_mktrw6k3",
        value: { label: "Working on it" },
        result: "FAILED",
        error: error instanceof Error ? error.message : "Unknown error",
      });

      // Try simple string
      try {
        const statusTest2 = await mondayClient.createItem(
          boardIds.deals,
          "TEST Status String",
          {
            color_mktrw6k3: "Working on it", // Simple string
          }
        );
        results.tests.push({
          test: "Status - Simple String",
          column: "color_mktrw6k3",
          value: "Working on it",
          result: "SUCCESS",
          itemId: statusTest2.id,
        });
      } catch (error2) {
        results.tests.push({
          test: "Status - Simple String",
          column: "color_mktrw6k3",
          value: "Working on it",
          result: "FAILED",
          error: error2 instanceof Error ? error2.message : "Unknown error",
        });
      }
    }

    // Test 6: Date column format
    console.log("📅 Testing date column format...");
    try {
      const dateTest = await mondayClient.createItem(
        boardIds.deals,
        "TEST Date Format",
        {
          deal_expected_close_date: "2025-12-31", // Simple string
        }
      );
      results.tests.push({
        test: "Date - Simple String",
        column: "deal_expected_close_date",
        value: "2025-12-31",
        result: "SUCCESS",
        itemId: dateTest.id,
      });
    } catch (error) {
      results.tests.push({
        test: "Date - Simple String",
        column: "deal_expected_close_date",
        value: "2025-12-31",
        result: "FAILED",
        error: error instanceof Error ? error.message : "Unknown error",
      });

      // Try date object format
      try {
        const dateTest2 = await mondayClient.createItem(
          boardIds.deals,
          "TEST Date Object",
          {
            deal_expected_close_date: { date: "2025-12-31" },
          }
        );
        results.tests.push({
          test: "Date - Object Format",
          column: "deal_expected_close_date",
          value: { date: "2025-12-31" },
          result: "SUCCESS",
          itemId: dateTest2.id,
        });
      } catch (error2) {
        results.tests.push({
          test: "Date - Object Format",
          column: "deal_expected_close_date",
          value: { date: "2025-12-31" },
          result: "FAILED",
          error: error2 instanceof Error ? error2.message : "Unknown error",
        });
      }
    }

    console.log("✅ [Format Tester] All tests completed");

    // Generate recommendations based on successful tests
    const successful = results.tests.filter((t: any) => t.result === "SUCCESS");
    const recommendations: any = {};

    successful.forEach((test: any) => {
      recommendations[test.column] = {
        format: test.value,
        testName: test.test,
      };
    });

    res.status(200).json({
      success: true,
      message: "Monday column format testing completed",
      ...results,
      recommendations,
      summary: {
        totalTests: results.tests.length,
        successful: successful.length,
        failed: results.tests.length - successful.length,
      },
      instructions: {
        message: "Use the successful formats in your sync service",
        nextStep: "Update column value assignments based on working formats",
      },
    });
  } catch (error) {
    console.error("[Format Tester] Error:", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
      message: "Failed to test Monday column formats",
    });
  }
}
