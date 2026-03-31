const http = require('http');

const PORT = 3002;

// Mock KYC data - person information for Bank KYC by NIN (National Identification Number)
const kycDatabase = {
  "CM19951234567890": {
    person: {
      first_name: "John",
      middle_name: "Michael",
      last_name: "Doe",
      full_name: "John Michael Doe",
      date_of_birth: "1995-03-15",
      place_of_birth: "Colombo",
      gender: "Male",
      nationality: "Sri Lankan",
      marital_status: "Married",
      tax_id: "TIN-LK-2019-84523",
      source_of_funds: "Employment Income",
      identifiers: {
        national_id: "CM19951234567890",
        passport_number: "N1234567",
        driving_license: "DL-987654"
      },
      contact: {
        email: "john.doe@example.com",
        home_phone: "+94112345678",
        mobile_phone: "+94771234567",
        address: {
          line1: "42 Temple Road",
          line2: "Colombo 03",
          city: "Colombo",
          state: "Western Province",
          postal_code: "00300",
          country: "Sri Lanka"
        }
      },
      employment: {
        employer: "Acme Financial Services",
        designation: "Senior Analyst",
        employment_type: "Full Time",
        annual_income: 4800000
      }
    }
  },
  "CF19900722123456": {
    person: {
      first_name: "Jane",
      middle_name: "Elizabeth",
      last_name: "Smith",
      full_name: "Jane Elizabeth Smith",
      date_of_birth: "1990-07-22",
      place_of_birth: "Kandy",
      gender: "Female",
      nationality: "Sri Lankan",
      marital_status: "Single",
      tax_id: "TIN-LK-2020-91247",
      source_of_funds: "Employment Income",
      identifiers: {
        national_id: "CF19900722123456",
        passport_number: "N7654321",
        driving_license: "DL-123456"
      },
      contact: {
        email: "jane.smith@example.com",
        home_phone: "+94112223344",
        mobile_phone: "+94779876543",
        address: {
          line1: "15 Peradeniya Road",
          line2: "Kandy",
          city: "Kandy",
          state: "Central Province",
          postal_code: "20000",
          country: "Sri Lanka"
        }
      },
      employment: {
        employer: "Lanka Banking Corp",
        designation: "Branch Manager",
        employment_type: "Full Time",
        annual_income: 6000000
      }
    }
  },
  "CF19781234567890": {
    person: {
      first_name: "Amal",
      middle_name: "Kumara",
      last_name: "Perera",
      full_name: "Amal Kumara Perera",
      date_of_birth: "1978-11-02",
      place_of_birth: "Matara",
      gender: "Male",
      nationality: "Sri Lankan",
      marital_status: "Married",
      tax_id: "TIN-LK-2015-33891",
      source_of_funds: "Business Income",
      identifiers: {
        national_id: "CF19951234567890",
        passport_number: "N3344556",
        driving_license: "DL-556677"
      },
      contact: {
        email: "amal.perera@example.com",
        home_phone: "+94412345678",
        mobile_phone: "+94773344556",
        address: {
          line1: "78 Galle Road",
          line2: "Matara",
          city: "Matara",
          state: "Southern Province",
          postal_code: "81000",
          country: "Sri Lanka"
        }
      },
      employment: {
        employer: "Self Employed - Perera Gems & Jewellery",
        designation: "Owner",
        employment_type: "Self Employed",
        annual_income: 7200000
      }
    }
  },
  "NIN-1122334455": {
    person: {
      first_name: "Nimal",
      middle_name: "Sanjeewa",
      last_name: "Fernando",
      full_name: "Nimal Sanjeewa Fernando",
      date_of_birth: "1992-06-18",
      place_of_birth: "Negombo",
      gender: "Male",
      nationality: "Sri Lankan",
      marital_status: "Single",
      tax_id: "TIN-LK-2022-67102",
      source_of_funds: "Employment Income",
      identifiers: {
        national_id: "NIN-1122334455",
        passport_number: "N9988776",
        driving_license: "DL-112233"
      },
      contact: {
        email: "nimal.fernando@example.com",
        home_phone: "+94312345678",
        mobile_phone: "+94775566778",
        address: {
          line1: "23 Lewis Place",
          line2: "Negombo",
          city: "Negombo",
          state: "Western Province",
          postal_code: "11500",
          country: "Sri Lanka"
        }
      },
      employment: {
        employer: "Ceylon Tech Solutions",
        designation: "Software Engineer",
        employment_type: "Full Time",
        annual_income: 3600000
      }
    }
  }
};

// Default person for unknown NIINs
const defaultPerson = {
  person: {
    first_name: "Demo",
    middle_name: "User",
    last_name: "Test",
    full_name: "Demo User Test",
    date_of_birth: "1995-01-01",
    place_of_birth: "Galle",
    gender: "Male",
    nationality: "Sri Lankan",
    marital_status: "Single",
    tax_id: "TIN-LK-0000-00000",
    source_of_funds: "Not Specified",
    identifiers: {
      national_id: "UNKNOWN",
      passport_number: "N0000000",
      driving_license: "DL-000000"
    },
    contact: {
      email: "demo@example.com",
      home_phone: "+94110000000",
      mobile_phone: "+94770000000",
      address: {
        line1: "1 Demo Street",
        line2: "",
        city: "Galle",
        state: "Southern Province",
        postal_code: "80000",
        country: "Sri Lanka"
      }
    },
    employment: {
      employer: "Demo Corp",
      designation: "Demo Role",
      employment_type: "Full Time",
      annual_income: 3600000
    }
  }
};

const server = http.createServer((req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Account-Request-Information');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathParts = url.pathname.split('/').filter(Boolean);

  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);

  // Health check
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'healthy', service: 'mock-kyc-backend' }));
    return;
  }

  // GET /user/{nic} - Main KYC endpoint
  if (req.method === 'GET' && pathParts.length === 2 && pathParts[0] === 'user') {
    const nic = pathParts[1];
    const personData = kycDatabase[nic] || { ...defaultPerson };

    if (!kycDatabase[nic]) {
      personData.person.identifiers.national_id = nic;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(personData));
    return;
  }

  // 404 for everything else
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not Found', path: url.pathname }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Mock KYC Backend API running on port ${PORT}`);
  console.log(`Endpoints:`);
  console.log(`  GET /user/{nic}  - Get person KYC data by National ID`);
  console.log(`  GET /health      - Health check`);
});
