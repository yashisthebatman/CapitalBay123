# backend/app.py

import sqlite3
import hashlib # REMINDER: Use bcrypt or Argon2 in production for passwords!
import os
import json # For handling financial history serialization/deserialization
import datetime # Potentially needed if calculating years from a date
from flask import Flask, request, jsonify, g, session
from flask_cors import CORS
import logging # Import Flask's logger

# --- Configuration ---
DATABASE = 'database.db'
SECRET_KEY = os.urandom(24) # Strong secret key for sessions

# --- App Setup ---
app = Flask(__name__)
app.config['SECRET_KEY'] = SECRET_KEY
logging.basicConfig(level=logging.INFO)
CORS(app, origins=["http://localhost:8080", "http://127.0.0.1:5500", "null"], supports_credentials=True) # Added null origin for local file testing

# --- Database Helper Functions ---
def get_db():
    """Connects to the specific database."""
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = sqlite3.connect(DATABASE)
        db.row_factory = sqlite3.Row
    return db

@app.teardown_appcontext
def close_connection(exception):
    """Closes the database again at the end of the request."""
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()

def init_db():
    """Initializes the database schema."""
    try:
        with app.app_context():
            db = get_db()
            cursor = db.cursor()
            app.logger.info("Dropping existing tables (if they exist)...")
            cursor.execute("DROP TABLE IF EXISTS investor_interest")
            cursor.execute("DROP TABLE IF EXISTS startups")
            cursor.execute("DROP TABLE IF EXISTS users")

            app.logger.info("Creating users table...")
            cursor.execute('''
                CREATE TABLE users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    email TEXT UNIQUE NOT NULL,
                    password_hash TEXT NOT NULL,
                    user_type TEXT NOT NULL CHECK(user_type IN ('startup', 'investor')),
                    name TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')

            app.logger.info("Creating startups table...")
            # Removed estimated_valuation as it's now calculated
            cursor.execute('''
                CREATE TABLE startups (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    company_name TEXT NOT NULL,
                    description TEXT,
                    industry TEXT,
                    funding_goal REAL DEFAULT 0,
                    funding_acquired REAL DEFAULT 0,
                    years_operating INTEGER DEFAULT 0,
                    website TEXT,
                    logo_url TEXT, -- Added in registration form
                    financial_history TEXT, -- Stored as JSON
                    contact_phone TEXT,
                    equity_offered REAL DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
                )
            ''')

            app.logger.info("Creating investor_interest table...")
            cursor.execute('''
                CREATE TABLE investor_interest (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    investor_user_id INTEGER NOT NULL,
                    startup_id INTEGER NOT NULL,
                    expressed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(investor_user_id, startup_id),
                    FOREIGN KEY (investor_user_id) REFERENCES users (id) ON DELETE CASCADE,
                    FOREIGN KEY (startup_id) REFERENCES startups (id) ON DELETE CASCADE
                )
            ''')

            db.commit()
            app.logger.info("Database initialized successfully.")
    except Exception as e:
        app.logger.error(f"Error initializing database: {e}", exc_info=True)
        if 'db' in locals() and db:
             db.rollback()

@app.cli.command('init-db')
def init_db_command():
    """Clear existing data and create new tables via Flask CLI."""
    init_db()

# --- Password Hashing ---
def hash_password(password):
    """Hashes the password. IMPORTANT: Use bcrypt or Argon2 in production!"""
    return hashlib.sha256(password.encode('utf-8')).hexdigest()

def verify_password(stored_hash, provided_password):
    """Verifies a provided password against the stored hash."""
    return stored_hash == hash_password(provided_password)

# --- Risk Analysis Helper ---
def calculate_risk(startup_data):
    """
    Calculates a simplified risk score and category based on available data.
    THIS IS ILLUSTRATIVE ONLY - Real risk analysis is far more complex.
    """
    risk_score = 0
    reasons = []

    # Use .get() with defaults to handle potentially missing keys safely
    goal = startup_data.get('funding_goal', 0) or 0
    acquired = startup_data.get('funding_acquired', 0) or 0
    years = startup_data.get('years_operating', 0) or 0
    # Ensure financial_history is treated as a list, default to empty if not present/valid
    financials = startup_data.get('financial_history', [])
    if not isinstance(financials, list):
        app.logger.warning(f"Financial history data was not a list during risk calculation for startup ID {startup_data.get('id', 'N/A')}.")
        financials = [] # Default to empty list

    # Factor 1: Funding Gap
    if goal > 0 and acquired < (goal * 0.25):
        risk_score += 2
        reasons.append("Significant funding gap remaining.")
    elif goal > 0 and acquired < (goal * 0.75):
        risk_score += 1
        reasons.append("Moderate funding gap remaining.")

    # Factor 2: Operating History / Age
    if years < 1:
        risk_score += 2
        reasons.append("Very early stage (less than 1 year operating).")
    elif years < 3:
        risk_score += 1
        reasons.append("Relatively early stage (1-3 years operating).")

    # Factor 3: Financial Health (Simplified)
    if financials:
        try:
            last_year_data = financials[-1] # Assumes list is ordered

            revenue_str = last_year_data.get('revenue')
            profit_str = last_year_data.get('profit')
            revenue = None
            profit = None

            if revenue_str is not None:
                try: revenue = float(revenue_str)
                except (ValueError, TypeError): app.logger.warning(f"Could not convert revenue '{revenue_str}' to float.")
            if profit_str is not None:
                try: profit = float(profit_str)
                except (ValueError, TypeError): app.logger.warning(f"Could not convert profit '{profit_str}' to float.")

            if profit is not None and profit <= 0:
                risk_score += 1
                reasons.append("Last reported year shows no profit or a loss.")
            elif revenue is not None and revenue < 10000: # Arbitrary low threshold
                risk_score += 1
                reasons.append("Last reported year shows very low revenue.")
            elif profit is not None and profit > 0:
                 risk_score -= 0.5 # Reduce risk slightly for profit

        except (IndexError):
             app.logger.warning(f"Financial history list was empty when trying to access last element.")
        except (TypeError, ValueError) as e:
            app.logger.warning(f"Could not process financial data for risk: {e}")
        except Exception as e:
             app.logger.error(f"Unexpected error processing financial data for risk: {e}", exc_info=True)
    else:
         risk_score += 1 # No financial data provided adds some risk uncertainty
         reasons.append("No detailed financial history provided.")

    # Factor 4: Large Funding Goal
    if goal > 1000000: # Example: $1M+
         risk_score += 1
         reasons.append("Seeking significant funding amount (>$1M).")

    risk_score = max(0, risk_score) # Clamp risk score

    # Determine Category
    if risk_score >= 4: category = "High Risk"
    elif risk_score >= 2: category = "Average Risk"
    else: category = "Low Risk"

    return {"score": round(risk_score, 1), "category": category, "reasons": reasons}

# --- Valuation Calculation Helper ---
def calculate_valuation(startup_data):
    """
    Calculates a simplified estimated valuation.
    Example Logic: Post-Money = Funding Goal / Equity % -> Pre-Money = Post-Money - Funding Goal
    Returns Pre-Money Valuation or None if calculation is not possible.
    """
    try:
        goal = float(startup_data.get('funding_goal', 0) or 0)
        equity = float(startup_data.get('equity_offered', 0) or 0)

        if equity > 0 and equity <= 100 and goal > 0:
            post_money_valuation = goal / (equity / 100.0)
            pre_money_valuation = post_money_valuation - goal
            return max(0, round(pre_money_valuation))
        else:
            return None # Cannot calculate
    except (ValueError, TypeError, ZeroDivisionError) as e:
        app.logger.warning(f"Could not calculate valuation for startup {startup_data.get('id', 'N/A')}: {e}")
        return None


# --- API Routes ---

# --- Authentication ---
@app.route('/api/register', methods=['POST'])
def register():
    data = request.get_json()
    required_fields = ['email', 'password', 'name', 'user_type']
    if not data or not all(field in data for field in required_fields):
        app.logger.warning("Registration attempt with missing fields.")
        return jsonify({"error": "Missing required fields"}), 400
    if data['user_type'] not in ['startup', 'investor']:
         app.logger.warning(f"Registration attempt with invalid user type: {data.get('user_type')}")
         return jsonify({"error": "Invalid user type"}), 400

    db = get_db()
    cursor = db.cursor()

    try:
        cursor.execute("SELECT id FROM users WHERE email = ?", (data['email'],))
        if cursor.fetchone():
            app.logger.info(f"Registration failed: Email '{data.get('email')}' already exists.")
            return jsonify({"error": "Email already registered"}), 409

        hashed_pw = hash_password(data['password'])

        cursor.execute(
            "INSERT INTO users (email, password_hash, user_type, name) VALUES (?, ?, ?, ?)",
            (data['email'], hashed_pw, data['user_type'], data['name'])
        )
        user_id = cursor.lastrowid
        app.logger.info(f"User '{data.get('email')}' registered successfully with ID: {user_id}")

        # If it's a startup, create the startup profile
        if data['user_type'] == 'startup':
            company_name = data.get('company_name', '').strip() or data['name']
            funding_acquired = data.get('funding_acquired', 0)
            years_operating = data.get('years_operating', 0)
            funding_goal = data.get('funding_goal', 0)
            contact_phone = data.get('contact_phone', '').strip()
            equity_offered = data.get('equity_offered', 0)
            logo_url = data.get('logo_url', '') # Get logo URL

            try: equity_offered = float(equity_offered) if equity_offered is not None else 0
            except ValueError: equity_offered = 0

            # Financial history processing (ensure this is robust)
            financials_list = data.get('financials', [])
            financial_history_json = None
            validated_financials = []
            if isinstance(financials_list, list):
                 for item in financials_list:
                     if isinstance(item, dict) and 'year' in item and ('revenue' in item or 'profit' in item):
                         try:
                             # Attempt conversion, default to None on failure
                             item['revenue'] = float(item.get('revenue')) if item.get('revenue') is not None else None
                         except (ValueError, TypeError): item['revenue'] = None
                         try:
                             item['profit'] = float(item.get('profit')) if item.get('profit') is not None else None
                         except (ValueError, TypeError): item['profit'] = None
                         validated_financials.append(item)
                     else:
                        app.logger.warning(f"Skipping invalid financial entry during registration for user {user_id}: {item}")

                 if validated_financials:
                    try:
                        validated_financials.sort(key=lambda x: x.get('year', 0)) # Sort by year index
                        financial_history_json = json.dumps(validated_financials)
                    except TypeError as e:
                        app.logger.error(f"Could not serialize financial history for user {user_id}: {e}")
            else:
                app.logger.warning(f"Received non-list financial data for user {user_id}. Type: {type(financials_list)}")

            # Insert startup data (Removed estimated_valuation)
            cursor.execute(
                """
                INSERT INTO startups
                (user_id, company_name, description, industry, funding_goal,
                 funding_acquired, years_operating, website, logo_url, financial_history,
                 contact_phone, equity_offered)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (user_id, company_name, data.get('description', ''), data.get('industry', ''),
                 funding_goal, funding_acquired, years_operating,
                 data.get('website', ''), logo_url, # Use collected logo_url
                 financial_history_json,
                 contact_phone,
                 equity_offered)
             )
            app.logger.info(f"Startup profile created for user ID: {user_id}, company: '{company_name}'")

        db.commit()
        return jsonify({"message": "User registered successfully", "userId": user_id}), 201

    except sqlite3.IntegrityError as e:
        db.rollback()
        app.logger.error(f"Database Integrity Error during registration: {e}", exc_info=True)
        # Check if it's the email constraint
        if "UNIQUE constraint failed: users.email" in str(e):
             return jsonify({"error": "Email already registered"}), 409
        else:
             return jsonify({"error": "Database integrity error during registration"}), 400
    except Exception as e:
        db.rollback()
        app.logger.error(f"Unexpected Error during registration: {e}", exc_info=True)
        return jsonify({"error": "An internal server error occurred during registration"}), 500


@app.route('/api/login', methods=['POST'])
def login():
    data = request.get_json()
    if not data or not data.get('email') or not data.get('password'):
        return jsonify({"error": "Email and password required"}), 400

    email = data['email']
    password = data['password']
    db = get_db()
    cursor = db.cursor()

    try:
        cursor.execute("SELECT * FROM users WHERE email = ?", (email,))
        user = cursor.fetchone()

        if user and verify_password(user['password_hash'], password):
            session.clear()
            session['user_id'] = user['id']
            session['user_type'] = user['user_type']
            session['name'] = user['name']
            session['email'] = user['email']
            app.logger.info(f"User '{email}' logged in successfully.")
            user_info = {"id": user['id'], "email": user['email'], "name": user['name'], "user_type": user['user_type']}
            return jsonify({"message": "Login successful", "user": user_info}), 200
        else:
            app.logger.warning(f"Failed login attempt for email: '{email}'")
            return jsonify({"error": "Invalid email or password"}), 401
    except Exception as e:
        app.logger.error(f"Database error during login for email '{email}': {e}", exc_info=True)
        return jsonify({"error": "An error occurred during login"}), 500


@app.route('/api/logout', methods=['POST'])
def logout():
    user_email = session.get('email', 'Unknown User')
    session.clear()
    app.logger.info(f"User '{user_email}' logged out.")
    return jsonify({"message": "Logout successful"}), 200


@app.route('/api/auth/status', methods=['GET'])
def auth_status():
    if 'user_id' in session:
        user_info = {
            "id": session['user_id'],
            "email": session.get('email', ''),
            "name": session.get('name', ''),
            "user_type": session.get('user_type', '')
        }
        return jsonify({"logged_in": True, "user": user_info}), 200
    else:
        return jsonify({"logged_in": False}), 200


# --- Startups ---
@app.route('/api/startups', methods=['GET'])
def get_startups():
    """Gets a list of startups for card display, including risk category."""
    try:
        db = get_db()
        cursor = db.cursor()
        # Select fields needed for cards and risk calculation
        cursor.execute("""
            SELECT id, user_id, company_name, description, industry, funding_goal,
                   funding_acquired, years_operating, website, logo_url, financial_history
            FROM startups ORDER BY created_at DESC
        """)
        startup_rows = cursor.fetchall()

        startups_with_risk = []
        for row in startup_rows:
            startup_dict = dict(row)

            # Deserialize Financial History Safely for risk calc
            try:
                financial_history_json = startup_dict.get('financial_history')
                if financial_history_json and financial_history_json.strip():
                    startup_dict['financial_history'] = json.loads(financial_history_json)
                else:
                    startup_dict['financial_history'] = []
            except Exception as e_fin:
                app.logger.error(f"List API: Error processing financial_history for startup {startup_dict['id']}: {e_fin}")
                startup_dict['financial_history'] = []

            # Calculate Risk
            risk_info = calculate_risk(startup_dict)
            risk_category = risk_info.get('category', 'Unknown')

            # Data for Frontend Card (No sensitive info like contact or full financials)
            card_data = {
                "id": startup_dict['id'],
                "company_name": startup_dict['company_name'],
                "description": startup_dict.get('description', ''),
                "industry": startup_dict.get('industry', ''),
                "funding_goal": startup_dict.get('funding_goal', 0),
                "funding_acquired": startup_dict.get('funding_acquired', 0),
                "logo_url": startup_dict.get('logo_url', ''),
                "risk_category": risk_category
            }
            startups_with_risk.append(card_data)

        return jsonify(startups_with_risk), 200
    except Exception as e:
        app.logger.error(f"Error fetching startup list with risk: {e}", exc_info=True)
        return jsonify({"error": "Failed to fetch startup list"}), 500


@app.route('/api/startups/<int:startup_id>', methods=['GET'])
def get_startup_details(startup_id):
    """Gets detailed info for a specific startup, including calculated valuation."""
    try:
        db = get_db()
        cursor = db.cursor()
        # Select fields, no stored valuation needed
        cursor.execute("""
            SELECT s.*, u.name as founder_name, u.email as founder_email
            FROM startups s
            JOIN users u ON s.user_id = u.id
            WHERE s.id = ?
        """, (startup_id,))
        startup_row = cursor.fetchone()

        if startup_row:
            startup_dict = dict(startup_row)

            # Deserialize Financial History (Robustly)
            loaded_financials = []
            try:
                financial_history_json = startup_dict.get('financial_history')
                if financial_history_json and financial_history_json.strip():
                    raw_list = json.loads(financial_history_json)
                    if isinstance(raw_list, list):
                        # Optional: further validation/sorting if needed here
                        raw_list.sort(key=lambda x: x.get('year', float('inf')))
                        loaded_financials = raw_list
                startup_dict['financial_history'] = loaded_financials
            except json.JSONDecodeError as json_err:
                app.logger.error(f"Detail API: Failed to decode financial_history JSON for startup {startup_id}. Error: {json_err}.")
                startup_dict['financial_history'] = []
            except Exception as e_fin:
                app.logger.error(f"Detail API: Unexpected error processing financial_history for startup {startup_id}: {e_fin}", exc_info=True)
                startup_dict['financial_history'] = []

            # Calculate Risk
            risk_info = calculate_risk(startup_dict)
            startup_dict['risk_analysis'] = risk_info

            # Calculate Valuation
            calculated_val = calculate_valuation(startup_dict)
            startup_dict['calculated_valuation'] = calculated_val
            app.logger.debug(f"Calculated valuation for startup {startup_id}: {calculated_val}")

            # Check Investor Interest
            investor_has_expressed_interest = False
            if 'user_id' in session and session.get('user_type') == 'investor':
                try:
                    cursor.execute("SELECT 1 FROM investor_interest WHERE investor_user_id = ? AND startup_id = ?", (session['user_id'], startup_id))
                    investor_has_expressed_interest = bool(cursor.fetchone())
                except Exception as e_interest:
                    app.logger.error(f"Error checking investor interest for startup {startup_id}: {e_interest}", exc_info=True)
            startup_dict['investor_has_expressed_interest'] = investor_has_expressed_interest

            startup_dict.pop('user_id', None) # Remove internal ID

            return jsonify(startup_dict), 200
        else:
            app.logger.warning(f"Startup details requested but not found for ID: {startup_id}")
            return jsonify({"error": "Startup not found"}), 404
    except Exception as e:
         app.logger.error(f"Error fetching details for startup ID {startup_id}: {e}", exc_info=True)
         return jsonify({"error": "Failed to fetch startup details"}), 500

# --- Investor Interest ---
@app.route('/api/startups/<int:startup_id>/interest', methods=['POST', 'DELETE'])
def manage_investor_interest(startup_id):
    if 'user_id' not in session or session.get('user_type') != 'investor':
        return jsonify({"error": "Unauthorized"}), 403

    investor_user_id = session['user_id']
    db = get_db()
    cursor = db.cursor()

    # Check if startup exists
    cursor.execute("SELECT 1 FROM startups WHERE id = ?", (startup_id,))
    if not cursor.fetchone():
        return jsonify({"error": "Startup not found"}), 404

    if request.method == 'POST':
        try:
            cursor.execute("INSERT INTO investor_interest (investor_user_id, startup_id) VALUES (?, ?)", (investor_user_id, startup_id))
            db.commit()
            app.logger.info(f"Investor {investor_user_id} expressed interest in startup {startup_id}")
            return jsonify({"message": "Interest expressed successfully"}), 201
        except sqlite3.IntegrityError:
            db.rollback()
            return jsonify({"message": "Already expressed interest"}), 200
        except Exception as e:
            db.rollback()
            app.logger.error(f"Error expressing interest for startup {startup_id}: {e}", exc_info=True)
            return jsonify({"error": "Failed to express interest"}), 500

    elif request.method == 'DELETE':
        try:
            cursor.execute("DELETE FROM investor_interest WHERE investor_user_id = ? AND startup_id = ?", (investor_user_id, startup_id))
            rows_affected = cursor.rowcount
            db.commit()
            if rows_affected > 0:
                app.logger.info(f"Investor {investor_user_id} withdrew interest from startup {startup_id}")
                return jsonify({"message": "Interest withdrawn successfully"}), 200
            else:
                return jsonify({"message": "No interest found to withdraw"}), 404
        except Exception as e:
            db.rollback()
            app.logger.error(f"Error withdrawing interest for startup {startup_id}: {e}", exc_info=True)
            return jsonify({"error": "Failed to withdraw interest"}), 500

# --- Startup Analytics ---
@app.route('/api/my-startup/analytics', methods=['GET'])
def get_my_startup_analytics():
    if 'user_id' not in session or session.get('user_type') != 'startup':
        return jsonify({"error": "Unauthorized"}), 403

    startup_user_id = session['user_id']
    db = get_db()
    cursor = db.cursor()

    try:
        cursor.execute("SELECT id FROM startups WHERE user_id = ?", (startup_user_id,))
        startup_row = cursor.fetchone()
        if not startup_row: return jsonify({"error": "Startup profile not found"}), 404
        startup_id = startup_row['id']

        # Fetch interested investors (name and email only)
        cursor.execute("""
            SELECT u.name, u.email
            FROM investor_interest i
            JOIN users u ON i.investor_user_id = u.id
            WHERE i.startup_id = ? AND u.user_type = 'investor'
            ORDER BY i.expressed_at DESC
        """, (startup_id,))
        interested_investors = [dict(row) for row in cursor.fetchall()]

        app.logger.info(f"Fetched {len(interested_investors)} interested investors for startup {startup_id}")
        return jsonify({"interested_investors": interested_investors}), 200
    except Exception as e:
        app.logger.error(f"Error fetching analytics for startup user {startup_user_id}: {e}", exc_info=True)
        return jsonify({"error": "Failed to fetch analytics data"}), 500


# --- Manage Startup Profile (Non-Financials) ---
@app.route('/api/my-startup', methods=['GET', 'PUT'])
def manage_my_startup():
    if 'user_id' not in session or session.get('user_type') != 'startup':
        return jsonify({"error": "Unauthorized"}), 403

    user_id = session['user_id']
    db = get_db()
    cursor = db.cursor()

    if request.method == 'GET':
        # Fetch data for update form, including raw financial history JSON
        try:
            cursor.execute("""
                SELECT id, company_name, description, industry, funding_goal, funding_acquired,
                       years_operating, website, logo_url, contact_phone,
                       equity_offered, financial_history -- Include financial_history JSON
                FROM startups WHERE user_id = ?
            """, (user_id,))
            startup_data = cursor.fetchone()
            if not startup_data: return jsonify({"error": "Startup profile not found"}), 404

            startup_dict = dict(startup_data)
            # Try to parse financials for easier frontend use, fallback to empty list
            try:
                if startup_dict['financial_history']:
                    startup_dict['financial_history'] = json.loads(startup_dict['financial_history'])
                else:
                    startup_dict['financial_history'] = []
            except json.JSONDecodeError:
                app.logger.warning(f"Could not parse financial history JSON for user {user_id} in GET /my-startup.")
                startup_dict['financial_history'] = [] # Fallback

            return jsonify(startup_dict), 200
        except Exception as e:
             app.logger.error(f"Error fetching startup data for update form (user {user_id}): {e}", exc_info=True)
             return jsonify({"error": "Failed to fetch startup data"}), 500

    elif request.method == 'PUT':
        # Update NON-FINANCIAL Profile Data
        data = request.get_json()
        if not data: return jsonify({"error": "No data provided for update"}), 400

        allowed_fields = ['company_name', 'description', 'industry', 'funding_goal',
                          'funding_acquired', 'years_operating', 'website', 'logo_url',
                          'contact_phone', 'equity_offered'] # Excludes financials & valuation

        update_fields = []
        update_values = []

        for field in allowed_fields:
            if field in data:
                update_fields.append(f"{field} = ?")
                value = data[field]
                # Type conversions/validations
                if field in ['funding_goal', 'funding_acquired', 'equity_offered'] and value is not None:
                     try: value = float(value)
                     except (ValueError, TypeError): return jsonify({"error": f"Invalid numeric value for {field}"}), 400
                elif field == 'years_operating' and value is not None:
                     try: value = int(value)
                     except (ValueError, TypeError): return jsonify({"error": f"Invalid integer value for {field}"}), 400
                elif field == 'contact_phone' and value is not None:
                     value = str(value).strip()
                # Handle optional text fields possibly being null/empty
                if value == '' and field in ['website', 'logo_url', 'description', 'industry', 'contact_phone']:
                    value = None # Store as NULL if empty string is sent for optional text fields

                update_values.append(value)

        if not update_fields: return jsonify({"message": "No valid non-financial fields provided for update"}), 400

        update_values.append(user_id)
        sql = f"UPDATE startups SET {', '.join(update_fields)} WHERE user_id = ?"

        try:
            cursor.execute(sql, tuple(update_values))
            rows_affected = cursor.rowcount
            db.commit()

            if rows_affected == 0:
                cursor.execute("SELECT 1 FROM startups WHERE user_id = ?", (user_id,))
                if not cursor.fetchone(): return jsonify({"error": "Startup profile not found"}), 404
                else: return jsonify({"message": "No changes detected in profile details"}), 200

            app.logger.info(f"Startup non-financial profile updated successfully for user ID: {user_id}.")
            return jsonify({"message": "Startup profile details updated successfully"}), 200
        except Exception as e:
            db.rollback()
            app.logger.error(f"Error updating non-financial startup profile for user ID {user_id}: {e}", exc_info=True)
            return jsonify({"error": "An internal server error occurred during profile update"}), 500


# --- Update Startup Financial History ---
@app.route('/api/my-startup/financials', methods=['PUT'])
def update_my_startup_financials():
    if 'user_id' not in session or session.get('user_type') != 'startup':
        return jsonify({"error": "Unauthorized"}), 403
    user_id = session['user_id']

    financials_list = request.get_json()
    if not isinstance(financials_list, list):
         app.logger.warning(f"Received non-list financial data for update for user {user_id}.")
         return jsonify({"error": "Invalid data format: Expected a list of financial records"}), 400

    validated_financials = []
    seen_years = set()
    for item in financials_list:
        if isinstance(item, dict) and 'year' in item:
            try:
                year = int(item['year'])
                if year in seen_years:
                     app.logger.warning(f"Duplicate year {year} found in financial update for user {user_id}. Skipping.")
                     continue
                seen_years.add(year)

                revenue = item.get('revenue')
                profit = item.get('profit')
                # Store as float or None
                item_revenue = float(revenue) if revenue is not None else None
                item_profit = float(profit) if profit is not None else None

                validated_financials.append({'year': year, 'revenue': item_revenue, 'profit': item_profit})
            except (ValueError, TypeError) as e:
                 app.logger.warning(f"Skipping invalid financial entry during update for user {user_id}: {item} - Error: {e}")
        else:
            app.logger.warning(f"Skipping invalid financial entry format during update for user {user_id}: {item}")

    db = get_db()
    cursor = db.cursor()
    try:
        validated_financials.sort(key=lambda x: x.get('year', 0)) # Sort before storing
        financial_history_json = json.dumps(validated_financials) if validated_financials else None

        cursor.execute("UPDATE startups SET financial_history = ? WHERE user_id = ?", (financial_history_json, user_id))
        db.commit()
        app.logger.info(f"Successfully updated financial history for user {user_id}.")
        # Return the validated/sorted list
        return jsonify({"message": "Financial history updated successfully", "updated_financials": validated_financials}), 200
    except Exception as e:
        db.rollback()
        app.logger.error(f"Error updating financial history for user {user_id}: {e}", exc_info=True)
        return jsonify({"error": "Failed to update financial history"}), 500

# --- Main Execution ---
if __name__ == '__main__':
    if not os.path.exists(DATABASE):
         print(f"Database file '{DATABASE}' not found. Initializing...")
         with app.app_context():
             init_db()
    print("Starting Flask server...")
    # Ensure debug is False in production!
    app.run(debug=True, port=5000, host='127.0.0.1')
