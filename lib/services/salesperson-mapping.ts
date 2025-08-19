// lib/services/salesperson-mapping.ts - Updated with REAL Monday user IDs
import { logger } from "@/lib/utils/logger";

export interface MondayUser {
  id: number;
  name: string;
  email?: string;
}

export interface SalespersonMappingResult {
  success: boolean;
  mondayUserId: number | null;
  mondayUserName: string | null;
  simproSalesperson: string | null;
  matchType: "exact" | "fuzzy" | "none";
  message: string;
}

export class SalespersonMappingService {
  // ✅ UPDATED: Real Monday user IDs from your production environment
  private static readonly SALESPERSON_MAPPING: { [key: string]: MondayUser } = {
    "Phil Clark": {
      id: 75400577,
      name: "Phil Clark",
      email: "team@rasvertex.com.au",
    },
    "Shane Kidby": {
      id: 80119678,
      name: "Shane Kidby",
      email: "shane@rasvertex.com.au",
    },
    "Hylton Denton": {
      id: 80119681,
      name: "Hylton Denton",
      email: "hylton@rasvertex.com.au",
    },
  };

  /**
   * Safely get Monday user mapping - NEVER throws errors or breaks sync
   * Returns detailed mapping result for logging and debugging
   */
  static getMondayUserMapping(
    simproSalesperson?: string
  ): SalespersonMappingResult {
    try {
      // Handle null/undefined/empty salesperson
      if (!simproSalesperson?.trim()) {
        return {
          success: true, // Not an error - just no salesperson
          mondayUserId: null,
          mondayUserName: null,
          simproSalesperson: null,
          matchType: "none",
          message:
            "No salesperson provided - this is normal and sync continues",
        };
      }

      const cleanName = simproSalesperson.trim();

      // ✅ EXACT MATCH: Direct lookup first
      if (this.SALESPERSON_MAPPING[cleanName]) {
        const mondayUser = this.SALESPERSON_MAPPING[cleanName];
        return {
          success: true,
          mondayUserId: mondayUser.id,
          mondayUserName: mondayUser.name,
          simproSalesperson: cleanName,
          matchType: "exact",
          message: `Exact match: "${cleanName}" → Monday user ${mondayUser.id} (${mondayUser.name})`,
        };
      }

      // ✅ FUZZY MATCH: Handle variations (case, spacing, etc.)
      const normalizedInput = cleanName
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();

      for (const [mappedName, mondayUser] of Object.entries(
        this.SALESPERSON_MAPPING
      )) {
        const normalizedMapped = mappedName
          .toLowerCase()
          .replace(/\s+/g, " ")
          .trim();

        if (normalizedMapped === normalizedInput) {
          return {
            success: true,
            mondayUserId: mondayUser.id,
            mondayUserName: mondayUser.name,
            simproSalesperson: cleanName,
            matchType: "fuzzy",
            message: `Fuzzy match: "${cleanName}" → "${mappedName}" → Monday user ${mondayUser.id}`,
          };
        }
      }

      // ✅ NO MATCH: Not found, but that's okay
      return {
        success: true, // Still success - sync continues
        mondayUserId: null,
        mondayUserName: null,
        simproSalesperson: cleanName,
        matchType: "none",
        message: `No Monday user mapping found for: "${cleanName}" - sync continues without owner assignment`,
      };
    } catch (error) {
      // ✅ ERROR HANDLING: Even unexpected errors don't break sync
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      logger.warn(
        `[Salesperson Mapping] Unexpected error mapping "${simproSalesperson}": ${errorMessage}`
      );

      return {
        success: false, // Error occurred, but sync still continues
        mondayUserId: null,
        mondayUserName: null,
        simproSalesperson: simproSalesperson || null,
        matchType: "none",
        message: `Error during mapping: ${errorMessage} - sync continues without owner assignment`,
      };
    }
  }

  /**
   * Simple method to get just the Monday user ID (backward compatibility)
   */
  static getMondayUserId(simproSalesperson?: string): number | null {
    const result = this.getMondayUserMapping(simproSalesperson);
    return result.mondayUserId;
  }

  /**
   * Check if we have a mapping for this salesperson
   */
  static hasMapping(simproSalesperson?: string): boolean {
    const result = this.getMondayUserMapping(simproSalesperson);
    return result.mondayUserId !== null;
  }

  /**
   * Get all mapped salespeople for reference/debugging
   */
  static getMappedSalespeople(): { [key: string]: MondayUser } {
    return { ...this.SALESPERSON_MAPPING };
  }

  /**
   * Get mapping statistics for monitoring
   */
  static getMappingStats(): {
    totalMappings: number;
    mappedSalespeople: string[];
    lastUpdated: string;
  } {
    const mappedSalespeople = Object.keys(this.SALESPERSON_MAPPING);

    return {
      totalMappings: mappedSalespeople.length,
      mappedSalespeople,
      lastUpdated: new Date().toISOString(),
    };
  }

  /**
   * Validate all mappings (useful for testing/debugging)
   */
  static validateMappings(): {
    valid: boolean;
    issues: string[];
    summary: string;
  } {
    const issues: string[] = [];

    for (const [name, user] of Object.entries(this.SALESPERSON_MAPPING)) {
      // Check for missing or invalid user IDs
      if (!user.id || typeof user.id !== "number" || user.id <= 0) {
        issues.push(`Invalid user ID for "${name}": ${user.id}`);
      }

      // Check for missing names
      if (!user.name?.trim()) {
        issues.push(`Missing name for user ID ${user.id}`);
      }

      // Check for potential duplicates
      const duplicateIds = Object.values(this.SALESPERSON_MAPPING).filter(
        (u) => u.id === user.id
      ).length;
      if (duplicateIds > 1) {
        issues.push(`Duplicate Monday user ID ${user.id} for "${name}"`);
      }
    }

    return {
      valid: issues.length === 0,
      issues,
      summary:
        issues.length === 0
          ? `All ${
              Object.keys(this.SALESPERSON_MAPPING).length
            } mappings are valid`
          : `Found ${issues.length} issues in mappings`,
    };
  }

  /**
   * Safe logging helper - logs mapping result without breaking sync
   */
  static logMappingResult(result: SalespersonMappingResult): void {
    try {
      switch (result.matchType) {
        case "exact":
          logger.info(`[Salesperson] ✅ ${result.message}`);
          break;
        case "fuzzy":
          logger.info(`[Salesperson] ✅ ${result.message}`);
          break;
        case "none":
          if (result.simproSalesperson) {
            logger.info(`[Salesperson] ℹ️ ${result.message}`);
          } else {
            logger.debug(`[Salesperson] ${result.message}`);
          }
          break;
        default:
          logger.warn(`[Salesperson] ⚠️ ${result.message}`);
      }
    } catch (logError) {
      // Even logging errors shouldn't break anything
      console.warn(`[Salesperson] Logging error: ${logError}`);
    }
  }

  /**
   * Test method to verify a specific salesperson mapping
   */
  static testMapping(simproSalesperson: string): void {
    console.log(`\n🧪 Testing mapping for: "${simproSalesperson}"`);
    console.log("================================================");

    const result = this.getMondayUserMapping(simproSalesperson);
    this.logMappingResult(result);

    console.log("Result:", {
      mondayUserId: result.mondayUserId,
      mondayUserName: result.mondayUserName,
      matchType: result.matchType,
      success: result.success,
    });
    console.log("================================================\n");
  }

  /**
   * Get helpful info for administrators
   */
  static getAdminInfo(): {
    mappingCount: number;
    mappings: Array<{
      simproName: string;
      mondayUserId: number;
      mondayUserName: string;
      email?: string;
    }>;
    instructions: string[];
  } {
    const mappings = Object.entries(this.SALESPERSON_MAPPING).map(
      ([simproName, user]) => ({
        simproName,
        mondayUserId: user.id,
        mondayUserName: user.name,
        email: user.email,
      })
    );

    const instructions = [
      "✅ SALESPERSON MAPPING IS NOW ACTIVE:",
      "- Phil Clark → Monday user 75400577",
      "- Shane Kidby → Monday user 80119678",
      "- Hylton Denton → Monday user 80119681",
      "",
      "🔄 TO ENABLE SALESPERSON ASSIGNMENT:",
      "1. Uncomment the salesperson mapping logic in mapping-service.ts",
      "2. Add dealOwnerId to the deal creation in Monday API calls",
      "3. Test the sync to see salespeople assigned to deals",
    ];

    return {
      mappingCount: mappings.length,
      mappings,
      instructions,
    };
  }

  /**
   * Quick way to check if mappings need to be updated
   */
  static needsRealUserIds(): boolean {
    // Check if any IDs look like placeholders (< 100000000)
    return Object.values(this.SALESPERSON_MAPPING).some(
      (user) => user.id < 100000000
    );
  }
}

// Export for easier testing
export default SalespersonMappingService;
