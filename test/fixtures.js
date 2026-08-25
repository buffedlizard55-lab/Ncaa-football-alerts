// Minimal but realistic fixtures shaped exactly like ESPN's live responses.
// They are derived from the real JSON fetched from ESPN during development.

export const SCOREBOARD_FIXTURE = {
  leagues: [
    {
      id: '23',
      season: { year: 2024, displayName: '2024' }
    }
  ],
  events: [
    {
      id: '401628378',
      uid: 's:20~l:23~e:401628378',
      date: '2024-09-28T20:15Z',
      name: 'Mississippi State Bulldogs at Texas Longhorns',
      shortName: 'MSST @ TEX',
      week: { number: 5 },
      competitions: [
        {
          id: '401628378',
          date: '2024-09-28T20:15Z',
          venue: {
            id: '3910',
            fullName: 'DKR-Texas Memorial Stadium',
            address: { city: 'Austin', state: 'TX', country: 'USA' }
          },
          status: {
            type: {
              id: '3',
              name: 'STATUS_FINAL',
              state: 'post',
              completed: true,
              description: 'Final',
              detail: 'Final',
              shortDetail: 'Final'
            }
          },
          competitors: [
            {
              id: '251',
              homeAway: 'home',
              winner: true,
              score: '35',
              team: {
                id: '251',
                abbreviation: 'TEX',
                displayName: 'Texas Longhorns',
                shortDisplayName: 'Texas',
                conferenceId: '8',
                logo: 'https://a.espncdn.com/i/teamlogos/ncaa/500/251.png'
              },
              linescores: [{ value: 7, displayValue: '7' }],
              records: [{ name: 'overall', summary: '5-0', displayValue: '5-0' }]
            },
            {
              id: '344',
              homeAway: 'away',
              winner: false,
              score: '13',
              team: {
                id: '344',
                abbreviation: 'MSST',
                displayName: 'Mississippi State Bulldogs',
                shortDisplayName: 'Mississippi St',
                conferenceId: '8',
                logo: 'https://a.espncdn.com/i/teamlogos/ncaa/500/344.png'
              },
              linescores: [{ value: 7, displayValue: '7' }],
              records: [{ name: 'overall', summary: '4-1', displayValue: '4-1' }]
            }
          ],
          playByPlayAvailable: true
        }
      ]
    },
    {
      id: '401628379',
      uid: 's:20~l:23~e:401628379',
      date: '2024-09-28T19:00Z',
      name: 'Ohio State Buckeyes at Wisconsin Badgers',
      shortName: 'OSU @ WIS',
      week: { number: 5 },
      competitions: [
        {
          id: '401628379',
          date: '2024-09-28T19:00Z',
          venue: {
            id: '4002',
            fullName: 'Camp Randall Stadium',
            address: { city: 'Madison', state: 'WI', country: 'USA' }
          },
          status: {
            type: {
              id: '2',
              name: 'STATUS_IN_PROGRESS',
              state: 'in',
              completed: false,
              description: '4th Quarter',
              detail: '4th-QTR 0:53',
              shortDetail: '4th 0:53'
            },
            period: 4,
            displayClock: '0:53'
          },
          competitors: [
            {
              id: '194',
              homeAway: 'away',
              winner: true,
              score: '24',
              team: {
                id: '194',
                abbreviation: 'OSU',
                displayName: 'Ohio State Buckeyes',
                shortDisplayName: 'Ohio St',
                conferenceId: '5',
                logo: 'https://a.espncdn.com/i/teamlogos/ncaa/500/194.png'
              },
              linescores: [],
              records: []
            },
            {
              id: '275',
              homeAway: 'home',
              winner: false,
              score: '21',
              team: {
                id: '275',
                abbreviation: 'WIS',
                displayName: 'Wisconsin Badgers',
                shortDisplayName: 'Wisconsin',
                conferenceId: '5',
                logo: 'https://a.espncdn.com/i/teamlogos/ncaa/500/275.png'
              },
              linescores: [],
              records: []
            }
          ],
          playByPlayAvailable: true
        }
      ]
    },
    {
      id: '401628380',
      uid: 's:20~l:23~e:401628380',
      date: '2024-09-28T22:30Z',
      name: 'Fresno State Bulldogs at Boise State Broncos',
      shortName: 'FRES @ BOIS',
      week: { number: 5 },
      competitions: [
        {
          id: '401628380',
          date: '2024-09-28T22:30Z',
          venue: { fullName: 'Albertsons Stadium', address: { city: 'Boise', state: 'ID' } },
          status: { type: { id: '1', name: 'STATUS_SCHEDULED', state: 'pre', completed: false, detail: '7:30 PM', shortDetail: '7:30 PM' } },
          competitors: [
            {
              id: '278',
              homeAway: 'away',
              winner: false,
              score: '0',
              team: {
                id: '278',
                abbreviation: 'FRES',
                displayName: 'Fresno State Bulldogs',
                shortDisplayName: 'Fresno St',
                conferenceId: '17',
                logo: 'https://a.espncdn.com/i/teamlogos/ncaa/500/278.png'
              },
              linescores: [],
              records: []
            },
            {
              id: '68',
              homeAway: 'home',
              winner: false,
              score: '0',
              team: {
                id: '68',
                abbreviation: 'BOIS',
                displayName: 'Boise State Broncos',
                shortDisplayName: 'Boise St',
                conferenceId: '17',
                logo: 'https://a.espncdn.com/i/teamlogos/ncaa/500/68.png'
              },
              linescores: [],
              records: []
            }
          ],
          playByPlayAvailable: true
        }
      ]
    }
  ]
};

export const SUMMARY_FIXTURE = {
  header: {
    id: '401752687',
    season: { year: 2025, displayName: '2025' },
    week: 2,
    date: '2025-09-06T23:00Z',
    competitions: [
      {
        id: '401752687',
        date: '2025-09-06T23:00Z',
        venue: {
          id: '65',
          fullName: 'Tiger Stadium',
          address: { city: 'Baton Rouge', state: 'LA', country: 'USA' }
        },
        status: {
          type: {
            id: '3',
            name: 'STATUS_FINAL',
            state: 'post',
            completed: true,
            description: 'Final',
            detail: 'Final',
            shortDetail: 'Final'
          }
        },
        broadcasts: [
          {
            type: { id: '4', shortName: 'Streaming' },
            market: { id: '1', type: 'National' },
            media: { shortName: 'ESPN+' }
          }
        ],
        competitors: [
          {
            id: '2348',
            homeAway: 'away',
            winner: false,
            score: '7',
            team: {
              id: '2348',
              abbreviation: 'LT',
              displayName: 'Louisiana Tech Bulldogs',
              shortDisplayName: 'Louisiana Tech',
              conferenceId: '37',
              logo: 'https://a.espncdn.com/i/teamlogos/ncaa/500/2348.png'
            },
            linescores: [{ displayValue: '0' }, { displayValue: '0' }, { displayValue: '0' }, { displayValue: '7' }],
            record: [{ type: 'total', summary: '1-1', displayValue: '1-1' }]
          },
          {
            id: '99',
            homeAway: 'home',
            winner: true,
            score: '23',
            team: {
              id: '99',
              abbreviation: 'LSU',
              displayName: 'LSU Tigers',
              shortDisplayName: 'LSU',
              conferenceId: '8',
              logo: 'https://a.espncdn.com/i/teamlogos/ncaa/500/99.png'
            },
            linescores: [{ displayValue: '7' }, { displayValue: '3' }, { displayValue: '7' }, { displayValue: '6' }],
            record: [{ type: 'total', summary: '1-1', displayValue: '1-1' }]
          }
        ]
      }
    ]
  },
  boxscore: {
    teams: [
      {
        team: {
          id: '2348',
          abbreviation: 'LT',
          displayName: 'Louisiana Tech Bulldogs',
          shortDisplayName: 'Louisiana Tech'
        },
        homeAway: 'away',
        statistics: [
          { name: 'totalYards', displayValue: '154', label: 'Total Yards' },
          { name: 'firstDowns', displayValue: '12', label: '1st Downs' }
        ]
      },
      {
        team: {
          id: '99',
          abbreviation: 'LSU',
          displayName: 'LSU Tigers',
          shortDisplayName: 'LSU'
        },
        homeAway: 'home',
        statistics: [
          { name: 'totalYards', displayValue: '365', label: 'Total Yards' },
          { name: 'firstDowns', displayValue: '27', label: '1st Downs' }
        ]
      }
    ],
    players: [
      {
        team: { id: '2348', abbreviation: 'LT', displayName: 'Louisiana Tech Bulldogs', shortDisplayName: 'Louisiana Tech' },
        homeAway: 'away',
        statistics: [
          {
            name: 'passing',
            text: 'Louisiana Tech Passing',
            labels: ['C/ATT', 'YDS', 'TD', 'INT'],
            athletes: [
              {
                athlete: { id: '5296376', displayName: 'Trey Kukuk', jersey: '2' },
                stats: ['12/18', '50', '0', '0']
              }
            ],
            totals: ['15/26', '96', '1', '0']
          },
          {
            name: 'receiving',
            text: 'Louisiana Tech Receiving',
            labels: ['REC', 'YDS', 'TD'],
            athletes: [
              {
                athlete: { id: '4696972', displayName: 'Devin Gandy', jersey: '1' },
                stats: ['1', '33', '1']
              }
            ],
            totals: ['15', '96', '1']
          }
        ]
      },
      {
        team: { id: '99', abbreviation: 'LSU', displayName: 'LSU Tigers', shortDisplayName: 'LSU' },
        homeAway: 'home',
        statistics: [
          {
            name: 'passing',
            text: 'LSU Passing',
            labels: ['C/ATT', 'YDS', 'TD', 'INT'],
            athletes: [
              {
                athlete: { id: '5176195', displayName: 'Garrett Nussmeier', jersey: '13' },
                stats: ['8/10', '89', '1', '0']
              }
            ],
            totals: ['26/41', '237', '2', '1']
          }
        ]
      }
    ]
  },
  plays: [
    {
      id: '401752687104999903',
      sequenceNumber: 104999903,
      type: { id: '67', text: 'Passing Touchdown', abbreviation: 'TD' },
      text: 'Nic Anderson 7 Yd pass from Garrett Nussmeier (Damian Ramos Kick)',
      awayScore: 0,
      homeScore: 7,
      period: { number: 1 },
      clock: { displayValue: '0:12' },
      scoringPlay: true,
      priority: false,
      teamParticipants: [
        { team: { id: '99', abbreviation: 'LSU' }, order: 1, type: 'offense' },
        { team: { id: '2348', abbreviation: 'LT' }, order: 2, type: 'defense' }
      ],
      statYardage: 7,
      start: { downDistanceText: '1st & Goal at LSU 7' },
      end: { downDistanceText: '—' }
    },
    {
      id: '401752687104889101',
      sequenceNumber: 104889101,
      type: { id: '5', text: 'Rush', abbreviation: 'RUSH' },
      text: 'Fred Robertson run for 2 yds to the LT 22',
      awayScore: 0,
      homeScore: 20,
      period: { number: 4 },
      clock: { displayValue: '11:08' },
      scoringPlay: false,
      priority: false,
      teamParticipants: [
        { team: { id: '2348', abbreviation: 'LT' }, order: 1, type: 'offense' },
        { team: { id: '99', abbreviation: 'LSU' }, order: 2, type: 'defense' }
      ],
      statYardage: 2,
      start: { downDistanceText: '1st & 15 at LT 20' },
      end: { downDistanceText: '2nd & 13 at LT 22' }
    }
  ],
  drives: [
    {
      id: '40175268718',
      description: '3 plays, -14 yards, 1:38',
      team: {
        id: '99',
        name: 'Tigers',
        abbreviation: 'LSU',
        displayName: 'LSU Tigers',
        shortDisplayName: 'LSU'
      },
      start: { period: { number: 4 }, clock: { displayValue: '3:52' } },
      end: { period: { number: 4 }, clock: { displayValue: '1:55' } },
      timeElapsed: { displayValue: '1:57' },
      yards: 48,
      isScore: true,
      offensivePlays: 6,
      result: 'FG',
      displayResult: 'Field Goal',
      plays: [
        {
          id: '401752687104964701',
          sequenceNumber: 104964701,
          type: { id: '12', text: 'Kickoff Return (Offense)' },
          text: 'Drew Henderson kickoff for 57 yds , Barion Brown return for 42 yds to the 50 yard line',
          awayScore: 7,
          homeScore: 20,
          period: { number: 4 },
          clock: { displayValue: '3:52' },
          scoringPlay: false,
          teamParticipants: [
            { team: { id: '99', abbreviation: 'LSU' }, order: 1, type: 'offense' },
            { team: { id: '2348', abbreviation: 'LT' }, order: 2, type: 'defense' }
          ],
          statYardage: 42
        }
      ]
    }
  ],
  scoringPlays: [
    {
      id: '401752687104999903',
      type: { id: '67', text: 'Passing Touchdown', abbreviation: 'TD' },
      text: 'Nic Anderson 7 Yd pass from Garrett Nussmeier (Damian Ramos Kick)',
      awayScore: 0,
      homeScore: 7,
      period: { number: 1 },
      clock: { displayValue: '0:12' },
      team: { id: '99' }
    }
  ]
};
