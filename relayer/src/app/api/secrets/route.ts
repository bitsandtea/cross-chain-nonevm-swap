import { db, saveDatabase } from "@/lib/database";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/secrets
 * Returns unprocessed secrets for authorized resolvers
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.RESOLVER_API_KEY}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await db.read();
    const unprocessedSecrets =
      db.data?.secrets?.filter((s) => !s.processed) || [];

    return NextResponse.json({ secrets: unprocessedSecrets });
  } catch (error) {
    console.error("Error fetching secrets:", error);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
}

/**
 * PATCH /api/secrets
 * Marks a secret as processed
 */
export async function PATCH(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.RESOLVER_API_KEY}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { orderHash } = await req.json();

    if (!orderHash) {
      return NextResponse.json(
        { error: "orderHash required" },
        { status: 400 }
      );
    }

    await db.read();
    const secret = db.data?.secrets?.find((s) => s.orderHash === orderHash);

    if (secret) {
      secret.processed = true;
      await saveDatabase();
      console.log(`Secret marked as processed for order ${orderHash}`);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error marking secret as processed:", error);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
}
