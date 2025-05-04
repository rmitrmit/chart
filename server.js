const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
app.use(cors());

const KWORB_BASE = 'https://kworb.net/spotify/track/';

// Validate and normalize date string (accepts YYYY-MM-DD or YYYY/MM/DD)
function normalizeDate(dateStr) {
  // Handle YYYY/MM/DD format
  const altFormat = dateStr.replace(/\//g, '-');
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!regex.test(altFormat)) return null;
  const date = new Date(altFormat);
  if (!(date instanceof Date) || isNaN(date)) return null;
  return altFormat; // Return normalized YYYY-MM-DD
}

// Parse stream count from formats like "192 (7817631)", "--", or "123456"
function parseStreamCount(countText) {
  if (!countText || countText === '--') return null;
  // Extract number from "192 (7817631)" or similar
  const match = countText.match(/\((\d+)\)/);
  if (match) return parseInt(match[1], 10);
  // Try parsing directly if it's a plain number
  const count = parseInt(countText.replace(/,/g, ''), 10);
  return isNaN(count) ? null : count;
}

app.get('/streams/:trackId', async (req, res) => {
  const { trackId } = req.params;
  const url = `${KWORB_BASE}${trackId}.html`;

  try {
    // Fetch the page with a timeout
    const response = await axios.get(url, { timeout: 10000 });
    const html = response.data;
    const $ = cheerio.load(html);

    // Locate the stream data table
    const table = $('table').first();
    if (!table.length) {
      console.warn(`No table found for track ${trackId} at ${url}`);
      return res.status(404).json({ error: 'No stream data table found' });
    }

    // Extract daily data
    const rows = table.find('tr').slice(1); // Skip header row
    const dailyData = [];
    rows.each((_, row) => {
      const cols = $(row).find('td');
      const dateRaw = $(cols[0]).text().trim(); // e.g., "2023/05/04"
      const countText = $(cols[1]).text().trim(); // e.g., "192 (7817631)", "--"
      const date = normalizeDate(dateRaw);
      const count = parseStreamCount(countText);
      if (date && count !== null) {
        dailyData.push({ date, streams: count });
      } else {
        console.warn(`Invalid row for track ${trackId}: date=${dateRaw}, count=${countText}`);
      }
    });

    if (dailyData.length === 0) {
      console.warn(`No valid stream data for track ${trackId} at ${url}`);
      return res.status(404).json({ error: 'No valid stream data available' });
    }

    // Sort by date
    dailyData.sort((a, b) => new Date(a.date) - new Date(b.date));

    // Aggregate into weekly data (7-day periods)
    const weeklyData = [];
    if (dailyData.length > 0) {
      let weekStart = new Date(dailyData[0].date);
      let weekSum = 0;
      let weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6); // End of 7-day period

      dailyData.forEach(({ date, streams }) => {
        const currentDate = new Date(date);
        if (isNaN(currentDate)) {
          console.warn(`Skipping invalid date for track ${trackId}: ${date}`);
          return;
        }
        if (currentDate <= weekEnd) {
          weekSum += streams;
        } else {
          // Save the completed week
          if (!isNaN(weekStart) && weekSum > 0) {
            weeklyData.push({
              weekStart: weekStart.toISOString().split('T')[0],
              streams: weekSum
            });
          }
          // Start a new week
          weekStart = currentDate;
          weekSum = streams;
          weekEnd = new Date(weekStart);
          weekEnd.setDate(weekEnd.getDate() + 6);
        }
      });
      // Add the final week if it has data
      if (weekSum > 0 && !isNaN(weekStart)) {
        weeklyData.push({
          weekStart: weekStart.toISOString().split('T')[0],
          streams: weekSum
        });
      }
    }

    if (weeklyData.length === 0) {
      console.warn(`No weekly data aggregated for track ${trackId}`);
      return res.status(404).json({ error: 'No weekly stream data available' });
    }

    console.log(`Track ${trackId}: ${weeklyData.length} weekly data points`);
    res.json(weeklyData);
  } catch (err) {
    console.error(`Error fetching ${url}:`, err.message);
    res.status(500).json({ error: `Failed to fetch or parse Kworb data for track ${trackId}` });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
