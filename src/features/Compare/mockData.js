/* ========= Mock data ========= */
export function mockCompareData() {
  const A = { firstname: "อนุสรี", lastname: "ทับสุวรรณ", image: "" };
  return {
    events: [
      {
        id: "e1",
        title: "ร่าง พ.ร.บ. งบประมาณ",
        start_date: "2024-01-15",
        A: [
          {
            id: "a1",
            option: "เห็นด้วย",
            voter_party: "พรรค ก",
            voters: [A],
          },
        ],
        B: [
          {
            id: "b1",
            option: "เห็นด้วย",
            voter_party: "พรรค ข",
            voters: [{ firstname: "สมชาย", lastname: "ใจดี", image: "" }],
          },
          {
            id: "b2",
            option: "ไม่เห็นด้วย",
            voter_party: "พรรค ก",
            voters: [{ firstname: "ศิริพร", lastname: "วงศ์ดี", image: "" }],
          },
          {
            id: "b3",
            option: "เห็นด้วย",
            voter_party: "พรรค ค",
            voters: [{ firstname: "ธเนศ", lastname: "อินทร์ศิลา", image: "" }],
          },
        ],
      },
      {
        id: "e2",
        title: "ญัตติอภิปรายทั่วไป",
        start_date: "2024-03-02",
        A: [
          {
            id: "a2",
            option: "งดออกเสียง",
            voter_party: "พรรค ก",
            voters: [A],
          },
        ],
        B: [
          {
            id: "b4",
            option: "เห็นด้วย",
            voter_party: "พรรค ข",
            voters: [{ firstname: "สมชาย", lastname: "ใจดี", image: "" }],
          },
          {
            id: "b5",
            option: "งดออกเสียง",
            voter_party: "พรรค ค",
            voters: [{ firstname: "ธเนศ", lastname: "อินทร์ศิลา", image: "" }],
          },
        ],
      },
    ],
  };
}

export function mockProfilesData() {
  return {
    people: [
      {
        id: "pA",
        firstname: "อนุสรี",
        lastname: "ทับสุวรรณ",
        name: "อนุสรี ทับสุวรรณ",
        image: "",
        memberships: [
          {
            id: "m1",
            province: "กทม.",
            start_date: "2021-06-01",
            end_date: "2022-12-31",
            posts: [
              {
                role: "สมาชิก",
                label: "สมาชิก",
                organizations: [
                  {
                    id: "orgX",
                    name: "พรรค X",
                    name_en: "Party X",
                    classification: "POLITICAL_PARTY",
                    image: "",
                  },
                ],
              },
            ],
          },
          {
            id: "m2",
            province: "กทม.",
            start_date: "2023-01-01",
            end_date: null,
            posts: [
              {
                role: "ส.ส.",
                label: "ส.ส.",
                organizations: [
                  {
                    id: "orgA",
                    name: "พรรค ก",
                    name_en: "Party A",
                    classification: "POLITICAL_PARTY",
                    image: "",
                  },
                ],
              },
            ],
          },
        ],
      },

      {
        id: "pB1",
        name: "สมชาย ใจดี",
        image: "",
        memberships: [
          {
            id: "mb1",
            province: "เชียงใหม่",
            start_date: "2022-06-01",
            end_date: null,
            posts: [
              {
                role: "ส.ส.",
                label: "ส.ส.",
                organizations: [
                  {
                    id: "orgB",
                    name: "พรรค ข",
                    name_en: "Party B",
                    classification: "POLITICAL_PARTY",
                    image: "",
                  },
                ],
              },
            ],
          },
        ],
      },

      {
        id: "pB2",
        name: "ศิริพร วงศ์ดี",
        image: "",
        memberships: [
          {
            id: "mb2",
            province: "ขอนแก่น",
            start_date: "2024-02-01",
            end_date: null,
            posts: [
              {
                role: "ส.ส.",
                label: "ส.ส.",
                organizations: [
                  {
                    id: "orgA",
                    name: "พรรค ก",
                    name_en: "Party A",
                    classification: "POLITICAL_PARTY",
                    image: "",
                  },
                ],
              },
            ],
          },
        ],
      },

      {
        id: "pB3",
        name: "ธเนศ อินทร์ศิลา",
        image: "",
        memberships: [
          {
            id: "mb3",
            province: "ชลบุรี",
            start_date: "2020-01-01",
            end_date: null,
            posts: [
              {
                role: "ส.ส.",
                label: "ส.ส.",
                organizations: [
                  {
                    id: "orgC",
                    name: "พรรค ค",
                    name_en: "Party C",
                    classification: "POLITICAL_PARTY",
                    image: "",
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

export function mockOrgsData() {
  return {
    organizations: [
      { name: "พรรค ก", image: "" },
      { name: "พรรค ข", image: "" },
      { name: "พรรค ค", image: "" },
    ],
  };
}
