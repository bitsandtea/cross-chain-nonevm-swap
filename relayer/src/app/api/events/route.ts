import { NextResponse } from "next/server";
import { getDatabase } from "../../../lib/simpleDatabase";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const escrowAddress = searchParams.get("escrowAddress");
    const hashlock = searchParams.get("hashlock");
    const chainId = searchParams.get("chainId");

    const db = await getDatabase();
    let events;

    if (escrowAddress && chainId) {
      events = await db.getEventsForEscrow(escrowAddress, parseInt(chainId));
    } else if (hashlock && chainId) {
      events = await db.getEventsByHashlock(hashlock, parseInt(chainId));
    } else {
      // Return all events if no filters
      events = await db.getAllEvents();
    }

    return NextResponse.json({
      success: true,
      data: events,
      count: events.length,
    });
  } catch (error) {
    console.error("Error fetching events:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch events" },
      { status: 500 }
    );
  }
}
