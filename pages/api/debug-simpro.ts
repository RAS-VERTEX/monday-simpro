// pages/api/debug-simpro.ts - Direct test with detailed debugging
import { NextApiRequest, NextApiResponse } from "next";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const startTime = Date.now();

  try {
    console.log("🔍 [Debug] Testing SimPro API directly...");

    // Get environment variables
    const baseUrl = process.env.SIMPRO_BASE_URL;
    const accessToken = process.env.SIMPRO_ACCESS_TOKEN;
    const companyId = process.env.SIMPRO_COMPANY_ID;

    console.log("📋 [Debug] Environment check:", {
      hasBaseUrl: !!baseUrl,
      baseUrl: baseUrl,
      hasAccessToken: !!accessToken,
      accessTokenLength: accessToken?.length || 0,
      hasCompanyId: !!companyId,
      companyId: companyId,
    });

    if (!baseUrl || !accessToken || !companyId) {
      throw new Error("Missing SimPro environment variables");
    }

    // Clean the base URL
    const cleanBaseUrl = baseUrl.replace(/\/+$/, "");
    const apiUrl = `${cleanBaseUrl}/api/v1.0/companies/`;

    console.log("🌐 [Debug] Making request to:", apiUrl);
    console.log(
      "🔑 [Debug] Using Bearer token:",
      `Bearer ${accessToken.substring(0, 10)}...`
    );

    // Make direct API call with Bearer token
    const response = await fetch(apiUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });

    const responseTime = Date.now() - startTime;

    console.log("📡 [Debug] Response status:", response.status);
    console.log(
      "📡 [Debug] Response headers:",
      Object.fromEntries(response.headers.entries())
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("❌ [Debug] Error response:", errorText);

      return res.status(response.status).json({
        success: false,
        error: `SimPro API error ${response.status}: ${response.statusText}`,
        responseText: errorText,
        responseTime: `${responseTime}ms`,
        url: apiUrl,
        headers: {
          authorization: `Bearer ${accessToken.substring(0, 10)}...`,
        },
      });
    }

    const responseText = await response.text();
    console.log("✅ [Debug] Raw response text:", responseText);

    let data;
    try {
      data = JSON.parse(responseText);
      console.log("✅ [Debug] Parsed JSON:", data);
    } catch (parseError) {
      console.error("❌ [Debug] JSON parse error:", parseError);
      return res.status(500).json({
        success: false,
        error: "Failed to parse SimPro response as JSON",
        responseText: responseText,
        responseTime: `${responseTime}ms`,
      });
    }

    console.log("✅ [Debug] Success! Found companies:", data?.length || 0);

    res.status(200).json({
      success: true,
      message: "SimPro API connection successful",
      responseTime: `${responseTime}ms`,
      companiesFound: data?.length || 0,
      apiUrl: apiUrl,
      authMethod: "Bearer token",
      companies: data,
      rawResponse: responseText,
    });
  } catch (error) {
    const responseTime = Date.now() - startTime;
    console.error("❌ [Debug] Request failed:", error);

    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
      responseTime: `${responseTime}ms`,
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
}
