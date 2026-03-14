export function handleAppShare() {
  const shareData = {
    title: 'Alt Text Generator | Built-in AI Demo',
    text: 'Check out this UX demo for AI-assisted Alt Text generation using built-in AI APIs! Currently, supported in Chrome desktop.',
    url: 'https://exploractical.com/demos/alt-text/'
  };

  if (navigator.share) {
    navigator.share(shareData)
      .then(() => console.log('Successfully shared'))
      .catch((error) => console.log('Error sharing:', error));
  } else {
    // Basic fallback: copy to clipboard
    navigator.clipboard.writeText(shareData.url).then(() => {
      alert("Link copied to clipboard: " + shareData.url);
    });
  }
}

export function generateICSReminder() {
  const now = new Date();

  // Set to tomorrow at 10:00 AM local time
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  tomorrow.setHours(10, 0, 0, 0);

  // End time 10:30 AM
  const end = new Date(tomorrow);
  end.setMinutes(30);

  const title = 'Try AI Alt-Text Demo';
  const description = 'Open the demo on a browser supporting the multimodal Prompt API (e.g. Chrome desktop): https://exploractical.com/demos/alt-text/';

  const isAndroid = /Android/i.test(navigator.userAgent);

  if (isAndroid) {
    // Generate Google Calendar Link for Android
    const formatGCalDate = (date) => date.toISOString().replace(/-|:|\.\d+/g, '');
    const gcalUrl = new URL('https://calendar.google.com/calendar/render');
    gcalUrl.searchParams.append('action', 'TEMPLATE');
    gcalUrl.searchParams.append('text', title);
    gcalUrl.searchParams.append('dates', `${formatGCalDate(tomorrow)}/${formatGCalDate(end)}`);
    gcalUrl.searchParams.append('details', description);
    gcalUrl.searchParams.append('location', 'https://exploractical.com/demos/alt-text/');
    
    window.open(gcalUrl.toString(), '_blank');
  } else {
    // Generate ICS File for Desktop/iOS
    const formatDate = (date) => {
      // Local time formatting for ICS
      const pad = (n) => n.toString().padStart(2, '0');
      const y = date.getFullYear();
      const m = pad(date.getMonth() + 1);
      const d = pad(date.getDate());
      const h = pad(date.getHours());
      const min = pad(date.getMinutes());
      const s = pad(date.getSeconds());
      return `${y}${m}${d}T${h}${min}${s}`;
    };

    const icsData = `BEGIN:VCALENDAR
VERSION:2.0
CALSCALE:GREGORIAN
BEGIN:VEVENT
SUMMARY:${title}
DTSTART:${formatDate(tomorrow)}
DTEND:${formatDate(end)}
DESCRIPTION:${description}
LOCATION:https://exploractical.com/demos/alt-text/
STATUS:CONFIRMED
SEQUENCE:3
END:VEVENT
END:VCALENDAR`;

    const blob = new Blob([icsData], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'AltTextDemoReminder.ics';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}
