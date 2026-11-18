/**
 * Evidence level A only: Management Board resolutions published by GPW as PDF on
 * gpw.pl ("w sprawie określenia dni w roku …, w których nie odbędą się sesje
 * giełdowe i notowania w alternatywnym systemie obrotu"). Each list was
 * transcribed from the decoded text of the PDF; GPW lists weekdays only.
 *
 * Deliberately NOT included: resolution texts that were only available as media
 * reproductions (609/2009, 1255/2010, 807/2012, 812/2013, 545/2019), press
 * reports and market data. They are not primary sources; see
 * docs/gpw-session-calendar.md for how they are treated.
 */
export const OFFICIAL_GPW_RESOLUTIONS = [
  {
    year: 2022, resolution: "593/2021", adopted: "2021-06-10",
    url: "https://www.gpw.pl/pub/GPW/uchwaly/2021/593_2021.pdf",
    weekdays: ["2022-01-06", "2022-04-15", "2022-04-18", "2022-05-03", "2022-06-16", "2022-08-15", "2022-11-01", "2022-11-11", "2022-12-26"],
  },
  {
    year: 2023, resolution: "509/2022", adopted: "2022-06-02",
    url: "https://www.gpw.pl/pub/GPW/uchwaly/2022/509_2022.pdf",
    weekdays: ["2023-01-06", "2023-04-07", "2023-04-10", "2023-05-01", "2023-05-03", "2023-06-08", "2023-08-15", "2023-11-01", "2023-12-25", "2023-12-26"],
  },
  {
    year: 2024, resolution: "571/2023", adopted: "2023-06-15",
    url: "https://www.gpw.pl/pub/GPW/uchwaly/2023/571_2023.pdf",
    weekdays: ["2024-01-01", "2024-03-29", "2024-04-01", "2024-05-01", "2024-05-03", "2024-05-30", "2024-08-15", "2024-11-01", "2024-11-11", "2024-12-24", "2024-12-25", "2024-12-26", "2024-12-31"],
  },
  {
    year: 2025, resolution: "701/2024", adopted: "2024-06-06",
    url: "https://gpw.pl/pub/GPW/uchwaly/2024/701_2024.pdf",
    weekdays: ["2025-01-01", "2025-01-06", "2025-04-18", "2025-04-21", "2025-05-01", "2025-06-19", "2025-08-15", "2025-11-11", "2025-12-24", "2025-12-25", "2025-12-26", "2025-12-31"],
  },
  {
    year: 2026, resolution: "753/2025", adopted: "2025-06-12",
    url: "https://www.gpw.pl/pub/GPW/uchwaly/2025/753_2025.pdf",
    weekdays: ["2026-01-01", "2026-01-06", "2026-04-03", "2026-04-06", "2026-05-01", "2026-06-04", "2026-11-11", "2026-12-24", "2026-12-25", "2026-12-31"],
  },
  {
    year: 2027, resolution: "754/2025", adopted: "2025-06-12",
    url: "https://www.gpw.pl/pub/GPW/uchwaly/2025/754_2025.pdf",
    weekdays: ["2027-01-01", "2027-01-06", "2027-03-26", "2027-03-29", "2027-05-03", "2027-05-27", "2027-11-01", "2027-11-11", "2027-12-24", "2027-12-31"],
  },
  {
    year: 2028, resolution: "1089/2026", adopted: "2026-07-20",
    url: "https://www.gpw.pl/pub/GPW/uchwaly/2026/1089_2026.pdf",
    weekdays: ["2028-01-06", "2028-04-14", "2028-04-17", "2028-05-01", "2028-05-03", "2028-06-15", "2028-08-15", "2028-11-01", "2028-12-25", "2028-12-26"],
  },
];

/** GPW notice of 2018-11-02: the Management Board resolved on 2018-10-31 to cancel this session. */
export const GPW_EXTRAORDINARY_CLOSURE_2018 = {
  date: "2018-11-12",
  adopted: "2018-10-31",
  url: "https://www.gpw.pl/news?cmn_id=107609&title=No+exchange+trading+session+on+12+November+2018",
};
