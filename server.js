const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
app.use(cors());

const KWORB_BASE = 'https://kworb.net/spotify/track/';

app.get('/streams/:trackId', async (req, res) => {
  const { trackId } = req.params;
  const url = KWORB_BASE + trackId + '.html';

  try {
    // Add delay to avoid rate-limiting (optional, adjust as needed)
    await new Promise(resolve => setTimeout(resolve, 1000));
    const response = await axios.get(url, { timeout: 5000 });
    const html = response.data;
    const $ = cheerio.load(html);

    // Log page title for debugging
    const title = $('title').text();
    console.log(`Fetched ${url}: Title = ${title}`);

    // Find the first table
    const table = $('table').first();
    if (!table.length) {
      console.warn(`No table found for track ${trackId} at ${url}`);
      return res.status(404).json({ error: 'No stream data table found' });
    }

    // Parse rows, skipping header
    const rows = table.find('tr').slice(1);
    const data = [];
    rows.each((_, row) => {
      const cols = $(row).find('td');
      const date = $(cols[0]).text().trim(); // e.g., "2025-04-26"
      const countText = $(cols[1]).text().replace(/,/g, '');
      const count = parseInt(countText, 10);
      if (date && !isNaN(count)) {
        data.push({ date, streams: count });
      } else {
        console.warn(`Invalid row for track ${trackId}: date=${date}, count=${countText}`);
      }
    });

    if (data.length === 0) {
      console.warn(`No valid stream data for track ${trackId} at ${url}`);
      return res.status(404).json({ error: 'No valid stream data available' });
    }

    res.json(data);

  } catch (err) {
    console.error(`Error fetching ${url}:`, err.message);
    if (err.response) {
      console.error(`Status: ${err.response.status}, Data:`, err.response.data);
    } else if (err.request) {
      console.error('No response received from Kworb.net');
    } else {
      console.error('Error details:', err);
    }
    res.status(500).json({ error: 'Failed to fetch or parse Kworb data' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(` Spotify-streams API running on http://localhost:${PORT}`));