import express from 'express';
import axios from 'axios';
import * as cheerio from 'cheerio';

const app = express();
const PORT = process.env.PORT || 3000;

const KWORB_BASE = 'https://kworb.net/spotify/track/';

// Helper functions from your code
function normalizeDate(dateStr) {
  const altFormat = dateStr.replace(/\//g, '-');
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!regex.test(altFormat)) return null;
  const date = new Date(altFormat);
  return isNaN(date) ? null : altFormat;
}

function parseStreamCount(countText) {
  if (!countText || countText === '--') return null;
  const match = countText.match(/\((\d+)\)/);
  if (match) return parseInt(match[1], 10);
  const count = parseInt(countText.replace(/,/g, ''), 10);
  return isNaN(count) ? null : count;
}

// Your main handler as an Express route
app.get('/api/streams/:trackId', async (req, res) => {
  const { trackId } = req.params;
  const url = `${KWORB_BASE}${trackId}.html`;

  try {
    const response = await axios.get(url, { timeout: 10000 });
    const html = response.data;
    const $ = cheerio.load(html);

    const table = $('table').first();
    if (!table.length) {
      return res.status(404).json({ error: 'No stream data table found' });
    }

    const rows = table.find('tr').slice(1);
    const dailyData = [];

    rows.each((_, row) => {
      const cols = $(row).find('td');
      const dateRaw = $(cols[0]).text().trim();
      const countText = $(cols[1]).text().trim();
      const date = normalizeDate(dateRaw);
      const count = parseStreamCount(countText);
      if (date && count !== null) {
        dailyData.push({ date, streams: count });
      }
    });

    if (dailyData.length === 0) {
      return res.status(404).json({ error: 'No valid stream data available' });
    }

    dailyData.sort((a, b) => new Date(a.date) - new Date(b.date));

    // Aggregate into weekly data
    const weeklyData = [];
    let weekStart = new Date(dailyData[0].date);
    let weekSum = 0;
    let weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);

    for (const { date, streams } of dailyData) {
      const currentDate = new Date(date);
      if (currentDate <= weekEnd) {
        weekSum += streams;
      } else {
        weeklyData.push({
          weekStart: weekStart.toISOString().split('T')[0],
          streams: weekSum,
        });
        weekStart = currentDate;
        weekSum = streams;
        weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 6);
      }
    }

    if (weekSum > 0) {
      weeklyData.push({
        weekStart: weekStart.toISOString().split('T')[0],
        streams: weekSum,
      });
    }

    res.status(200).json(weeklyData);
  } catch (err) {
    console.error(`Error fetching ${url}:`, err.message);
    res.status(500).json({ error: `Failed to fetch or parse Kworb data for track ${trackId}` });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
