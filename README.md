# Open Data Certificate - Node.js Implementation

A modern, streamlined Node.js implementation of the Open Data Certificate questionnaire system, migrated from the original Ruby application.

## 🚀 Features

- **Simplified Architecture**: MongoDB-based data model with clear separation of concerns
- **Numeric Achievement Levels**: Streamlined 0-4 level system (none, basic, pilot, standard, exemplar)
- **RESTful API**: Clean, modern API design
- **Real-time Level Calculation**: Achievement levels calculated on-demand
- **Migration Support**: Complete data migration from Ruby PostgreSQL to MongoDB
- **JSON-based Survey Definition**: Flexible questionnaire structure using JSON files

## 📊 Architecture Overview

### Data Model
```
Survey (Questionnaire Definition)
├── Sections (Legal, Technical, etc.)
│   └── Elements (Questions & Logic)
    
ResponseSet (User's Questionnaire Attempt)
├── Responses (Individual Answers)
└── Achievement Level (0-4)

Certificate (Achievement Record)
├── ResponseSet Reference
└── Publication Status

Dataset (Data Being Certified)
├── Metadata
└── Owner Information
```

### Achievement Levels
Levels are stored per-survey in `Survey.levels` as a map keyed by level index (0–4):

```
levels: {
  "0": { title, description, icon },
  "1": { title, description, icon },
  ...
}
```

During migration, defaults are set:
- 0: “No level” — No level has yet been achieved (icon: images/badges/no_level_badge.png)
- 1: “Bronze” — A fantastic start… (icon: images/badges/raw_level_badge.png)
- 2: “Silver” — Extra effort went in… (icon: images/badges/pilot_level_badge.png)
- 3: “Gold” — Regularly published open data… (icon: images/badges/standard_level_badge.png)
- 4: “Platinum” — Above and beyond… (icon: images/badges/exemplar_level_badge.png)

The certificate view reads the survey’s `levels` to display the badge and description. The textual name is also mapped to a friendly string at render time.

## 🛠️ Setup Instructions

### Prerequisites
- Node.js 16+ 
- MongoDB 4.4+
- MySQL (for migration from Ruby app)

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd open-data-certificate-node
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Environment Configuration**
   Create a `.env` file (see `config.env.example`):
   ```env
   # MongoDB
   MONGO_URL=mongodb://localhost:27017/open_data_certificate

   # MySQL (for migration)
   MYSQL_HOST=127.0.0.1
   MYSQL_PORT=3306
   MYSQL_DATABASE=certificates
   MYSQL_USER=root
   MYSQL_PASSWORD=password

   # Server
   PORT=3000
   NODE_ENV=development

   # Session Secret
   SESSION_SECRET=your_session_secret

   # ODI OAuth Credentials
   DJANGO_CLIENT_ID=your_django_client_id
   DJANGO_CLIENT_SECRET=your_django_client_secret
   DJANGO_CALLBACK_URL=/auth/django/callback

   # Google OAuth Credentials
   GOOGLE_CLIENT_ID=your_google_client_id
   GOOGLE_CLIENT_SECRET=your_google_client_secret
   GOOGLE_CALLBACK_URL=/auth/google/callback
   ```

4. **Database Setup**
   ```bash
   # Start MongoDB
   mongod
   
   # Start MySQL (if migrating from Ruby app)
   # Ensure your Ruby app database is accessible
   ```

5. **Run Migration (Optional)**
   If migrating from the Ruby application:
   
   **Full Migration (recommended):**
   ```bash
   npm run migrate:surveys:full
   # or clear existing surveys first
   npm run migrate:surveys:full:clear
   ```
   
   **Single Survey Migration (for focused testing):**
   ```bash
   # Default single import (falls back to ID 3252)
   npm run migrate:surveys:single

   # Specify a survey ID via CLI arg
   npm run migrate:surveys:single -- --id=4000
   # or
   npm run migrate:surveys:single -- --survey-id=4000

   # Specify via env
   SINGLE_MODE=true SINGLE_SURVEY_ID=4000 node scripts/migrateSurveys.js
   
   # Clear existing surveys first
   npm run migrate:surveys:single:clear -- --id=4000
   ```

6. **Start the Application**
   ```bash
   # Development
   npm run dev
   
   # Production
   npm start
   ```

## 📁 Project Structure

```
├── models/                 # MongoDB schemas
│   ├── Survey.js
│   ├── User.js
│   ├── Dataset.js
│   ├── ResponseSet.js
│   └── Certificate.js
├── controllers/            # Web controllers
│   ├── certificates.js
│   └── responseSets.js
├── services/               # Business logic
│   └── levelCalculationService.js
├── routes/                 # Routes
│   ├── datasets.js         # Public + My datasets + certificates
│   ├── redirects.js        # Legacy redirects (locale-prefixed)
│   └── surveys.js          # JSON survey endpoint
├── views/                  # EJS templates
│   ├── pages/
│   │   ├── datasets/
│   │   │   ├── index.ejs
│   │   │   └── dataset.ejs
│   │   └── certificates/
│   │       └── show.ejs
│   └── partials/
│       └── header.ejs
├── public/                 # Static assets (css, images, lib)
├── scripts/                # Migration scripts
│   ├── migrateSurveys.js
│   └── migrateCertificates.js
└── .gitignore
```

## 🔄 Migration from Ruby

The migration script extracts data from the original Ruby MySQL database and transforms it for the new MongoDB schema:

### Migration Process
1. **Surveys**: Converts survey definitions to MongoDB format
2. **Users**: Migrates user accounts and preferences
3. **Datasets**: Transfers dataset metadata
4. **Response Sets**: Converts questionnaire responses to new format
5. **Certificates**: Migrates achievement records

### Test Migration Features
The migration script includes test mode options to validate the migration process:

- **Limited Records**: Test with a small subset of data
- **Mixed States**: Ensures variety in response set states (draft, published, archived)
- **Non-Blank Data**: Filters out empty records to ensure meaningful test data
- **Balanced Sampling**: Gets mix of admin/regular users, active/removed datasets, etc.

### Running Migration
See scripts and npm commands:

Surveys:
```bash
npm run migrate:surveys:single         # imports one (default 3252) or pass --id
npm run migrate:surveys:single:clear   # clear then import one
npm run migrate:surveys:full           # imports all per SQL criteria
npm run migrate:surveys:full:clear     # clear then full import
```

Certificates/Datasets:
```bash
npm run migrate:certificates:single        # migrate dataset 220763 by default (or --dataset-id)
npm run migrate:certificates:full          # migrate all datasets with published certs
```

## 🎯 Key Improvements

### Simplified Data Model
- **Unified Response Storage**: All responses stored as key-value pairs
- **No Complex Joins**: MongoDB document structure eliminates complex queries
- **Real-time Calculations**: Achievement levels calculated on-demand

### Modern Architecture
- **Routes**: Consolidated `/datasets` router and legacy `redirects` router
- **MVC-ish**: Controllers for pages and drill-down tables
- **Survey-driven Certificates**: Certificate titles, per-question statement text, and display controls come from the survey
- **Numeric Levels**: Simplified 0–4 achievement system, driven by `Survey.levels`

### Performance Benefits
- **Better Scalability**: MongoDB handles large datasets efficiently
- **Faster Queries**: Document-based queries are more efficient
- **Reduced Complexity**: Simplified data relationships

## 🌐 Route Definitions

### Public web routes
- `GET /` → Home
- `GET /about` → About page
- `GET /datasets` → Browse published datasets (no login)
- `GET /datasets/data` → JSON for published datasets table
- `GET /datasets/:id` → Dataset drill-down (published for anon; owner/all when logged in)
- `GET /datasets/:id/data` → JSON for dataset drill-down
- `GET /datasets/:datasetId/certificates` → List or redirect to a certificate for dataset
- `GET /datasets/:datasetId/certificates/:responseSetId` → Render a certificate

### Authenticated web routes
- `GET /datasets/my` → “My Datasets” (owner; all for admin)
- `GET /datasets/my/data` → JSON for “My Datasets”
- `GET /auth/*` → Auth routes (login, profile, logout)

### Legacy route redirects
- `/:locale/datasets/:datasetId/certificates[...]` → 301 to `/datasets/...`

### JSON survey endpoint
- `GET /data/survey` → Latest non-alpha survey definition

## 🧪 Testing

```bash
# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Run specific test file
npm test -- --testPathPattern=levelCalculationService
```

## 🚀 Deployment

### Docker
```bash
# Build image
docker build -t open-data-certificate .

# Run container
docker run -p 3000:3000 open-data-certificate
```

### Environment Variables (production example)
```env
NODE_ENV=production
MONGO_URL=mongodb://your-mongo-host:27017/open_data_certificate
PORT=3000
SESSION_SECRET=your_production_session_secret

# Optional: OAuth in production
DJANGO_CLIENT_ID=...
DJANGO_CLIENT_SECRET=...
DJANGO_CALLBACK_URL=/auth/django/callback
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_CALLBACK_URL=/auth/google/callback
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🙏 Acknowledgments

- Original Ruby implementation by the Open Data Institute
- Survey structure based on the Open Data Certificate questionnaire
- Migration patterns inspired by modern data migration practices 