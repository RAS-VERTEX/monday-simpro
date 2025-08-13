// pages/api/debug-contact-creation.ts - Debug exact contact creation issue
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
    };

    console.log(
      "🐛 [Debug] Testing exact contact creation with real values..."
    );

    const results: any = {
      timestamp: new Date().toISOString(),
      tests: [],
    };

    // First create a test account to link to (like the sync does)
    let testAccountId: string;
    try {
      const testAccount = await mondayClient.createItem(
        boardIds.accounts,
        "DEBUG Test Account",
        {}
      );
      testAccountId = testAccount.id;
      console.log(`✅ Created test account: ${testAccountId}`);
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: "Failed to create test account",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }

    // Test 1: Just email (like our successful test)
    console.log("📧 Test 1: Contact with just email...");
    try {
      const emailOnlyContact = await mondayClient.createItem(
        boardIds.contacts,
        "DEBUG Email Only",
        {
          contact_email: {
            email: "sales@stormguard.com.au",
            text: "sales@stormguard.com.au",
          },
        }
      );
      results.tests.push({
        test: "Email Only",
        result: "SUCCESS",
        itemId: emailOnlyContact.id,
        columnValues: {
          contact_email: {
            email: "sales@stormguard.com.au",
            text: "sales@stormguard.com.au",
          },
        },
      });
    } catch (error) {
      results.tests.push({
        test: "Email Only",
        result: "FAILED",
        error: error instanceof Error ? error.message : "Unknown error",
        columnValues: {
          contact_email: {
            email: "sales@stormguard.com.au",
            text: "sales@stormguard.com.au",
          },
        },
      });
    }

    // Test 2: Just phone (like our successful test)
    console.log("📞 Test 2: Contact with just phone...");
    try {
      const phoneOnlyContact = await mondayClient.createItem(
        boardIds.contacts,
        "DEBUG Phone Only",
        {
          contact_phone: "0416 615 234",
        }
      );
      results.tests.push({
        test: "Phone Only",
        result: "SUCCESS",
        itemId: phoneOnlyContact.id,
        columnValues: {
          contact_phone: "0416 615 234",
        },
      });
    } catch (error) {
      results.tests.push({
        test: "Phone Only",
        result: "FAILED",
        error: error instanceof Error ? error.message : "Unknown error",
        columnValues: {
          contact_phone: "0416 615 234",
        },
      });
    }

    // Test 3: Just account relation (like our successful test)
    console.log("🔗 Test 3: Contact with just account relation...");
    try {
      const relationOnlyContact = await mondayClient.createItem(
        boardIds.contacts,
        "DEBUG Relation Only",
        {
          contact_account: {
            item_ids: [parseInt(testAccountId)],
          },
        }
      );
      results.tests.push({
        test: "Account Relation Only",
        result: "SUCCESS",
        itemId: relationOnlyContact.id,
        columnValues: {
          contact_account: {
            item_ids: [parseInt(testAccountId)],
          },
        },
      });
    } catch (error) {
      results.tests.push({
        test: "Account Relation Only",
        result: "FAILED",
        error: error instanceof Error ? error.message : "Unknown error",
        columnValues: {
          contact_account: {
            item_ids: [parseInt(testAccountId)],
          },
        },
      });
    }

    // Test 4: Email + Phone (combination)
    console.log("📧📞 Test 4: Contact with email + phone...");
    try {
      const emailPhoneContact = await mondayClient.createItem(
        boardIds.contacts,
        "DEBUG Email+Phone",
        {
          contact_email: {
            email: "sales@stormguard.com.au",
            text: "sales@stormguard.com.au",
          },
          contact_phone: "0416 615 234",
        }
      );
      results.tests.push({
        test: "Email + Phone",
        result: "SUCCESS",
        itemId: emailPhoneContact.id,
        columnValues: {
          contact_email: {
            email: "sales@stormguard.com.au",
            text: "sales@stormguard.com.au",
          },
          contact_phone: "0416 615 234",
        },
      });
    } catch (error) {
      results.tests.push({
        test: "Email + Phone",
        result: "FAILED",
        error: error instanceof Error ? error.message : "Unknown error",
        columnValues: {
          contact_email: {
            email: "sales@stormguard.com.au",
            text: "sales@stormguard.com.au",
          },
          contact_phone: "0416 615 234",
        },
      });
    }

    // Test 5: Email + Account Relation
    console.log("📧🔗 Test 5: Contact with email + account relation...");
    try {
      const emailRelationContact = await mondayClient.createItem(
        boardIds.contacts,
        "DEBUG Email+Account",
        {
          contact_email: {
            email: "sales@stormguard.com.au",
            text: "sales@stormguard.com.au",
          },
          contact_account: {
            item_ids: [parseInt(testAccountId)],
          },
        }
      );
      results.tests.push({
        test: "Email + Account Relation",
        result: "SUCCESS",
        itemId: emailRelationContact.id,
        columnValues: {
          contact_email: {
            email: "sales@stormguard.com.au",
            text: "sales@stormguard.com.au",
          },
          contact_account: {
            item_ids: [parseInt(testAccountId)],
          },
        },
      });
    } catch (error) {
      results.tests.push({
        test: "Email + Account Relation",
        result: "FAILED",
        error: error instanceof Error ? error.message : "Unknown error",
        columnValues: {
          contact_email: {
            email: "sales@stormguard.com.au",
            text: "sales@stormguard.com.au",
          },
          contact_account: {
            item_ids: [parseInt(testAccountId)],
          },
        },
      });
    }

    // Test 6: EXACT sync values (what's actually failing)
    console.log("🎯 Test 6: EXACT sync values from failed sync...");
    try {
      const exactSyncContact = await mondayClient.createItem(
        boardIds.contacts,
        "DEBUG Exact Sync Values",
        {
          contact_email: {
            email: "sales@stormguard.com.au",
            text: "sales@stormguard.com.au",
          },
          contact_phone: "0416 615 234",
          contact_account: {
            item_ids: [parseInt(testAccountId)],
          },
          text_mktr67s0: `SimPro Contact ID: 873
Contact Type: customer
Department: Not specified
Position: Not specified
Last Sync: ${new Date().toISOString()}`,
        }
      );
      results.tests.push({
        test: "EXACT Sync Values",
        result: "SUCCESS",
        itemId: exactSyncContact.id,
        columnValues: "Full sync column values",
      });
    } catch (error) {
      results.tests.push({
        test: "EXACT Sync Values",
        result: "FAILED",
        error: error instanceof Error ? error.message : "Unknown error",
        columnValues: "Full sync column values - THIS IS THE PROBLEM",
      });
    }

    // Test 7: Try without notes field
    console.log("📝 Test 7: Without notes field...");
    try {
      const noNotesContact = await mondayClient.createItem(
        boardIds.contacts,
        "DEBUG No Notes",
        {
          contact_email: {
            email: "sales@stormguard.com.au",
            text: "sales@stormguard.com.au",
          },
          contact_phone: "0416 615 234",
          contact_account: {
            item_ids: [parseInt(testAccountId)],
          },
          // NO notes field
        }
      );
      results.tests.push({
        test: "Without Notes Field",
        result: "SUCCESS",
        itemId: noNotesContact.id,
        conclusion: "NOTES FIELD IS THE PROBLEM!",
      });
    } catch (error) {
      results.tests.push({
        test: "Without Notes Field",
        result: "FAILED",
        error: error instanceof Error ? error.message : "Unknown error",
        conclusion: "Something else is the problem",
      });
    }

    console.log("✅ [Debug] Contact creation debug completed");

    const successful = results.tests.filter((t: any) => t.result === "SUCCESS");
    const failed = results.tests.filter((t: any) => t.result === "FAILED");

    res.status(200).json({
      success: true,
      message: "Contact creation debug completed",
      ...results,
      summary: {
        totalTests: results.tests.length,
        successful: successful.length,
        failed: failed.length,
      },
      analysis: {
        message: "Check which specific combination is causing the failure",
        workingCombinations: successful.map((t) => t.test),
        failingCombinations: failed.map((t) => t.test),
        nextStep: "Fix the sync service based on working combinations",
      },
      testAccountId,
    });
  } catch (error) {
    console.error("[Debug] Error:", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
      message: "Failed to debug contact creation",
    });
  }
}
