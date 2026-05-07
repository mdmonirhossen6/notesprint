import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const { rating, comment } = await request.json();
    
    const botToken = process.env.TELEGRAM_BOT_TOKEN || "8626105657:AAF-sRZpYtpqDmQp_KdSFzXc136UdKmPD34";
    const chatId = process.env.TELEGRAM_CHAT_ID || "6885443469";

    const text = `🚀 *New Feedback on NoteSprint*\n\n⭐ Rating: ${rating}/5\n💬 Comment: ${comment || 'No comment'}\n📅 Date: ${new Date().toLocaleString()}`;

    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'Markdown'
      })
    });

    const result = await response.json();

    if (!result.ok) {
      console.error('Telegram API error:', result);
      return NextResponse.json({ error: 'Failed to send Telegram message' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Feedback API error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
