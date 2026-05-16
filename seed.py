import random
from app import app
from models import db, User, Country, Airport, Flight, CurrencyRate
from werkzeug.security import generate_password_hash

countries_data = {
    "Россия": ["SVO", "LED"],
    "США": ["JFK", "LAX"],
    "Франция": ["CDG", "ORY"],
    "Великобритания": ["LHR", "LGW"],
    "Германия": ["FRA"],
    "Турция": ["IST"],
    "ОАЭ": ["DXB"],
    "Испания": ["BCN"],
    "Нидерланды": ["AMS"],
}

# Реальные города для каждого кода аэропорта
airport_cities = {
    "SVO": "Москва",
    "LED": "Санкт-Петербург",
    "JFK": "Нью-Йорк",
    "LAX": "Лос-Анджелес",
    "CDG": "Париж",
    "ORY": "Париж (Орли)",
    "LHR": "Лондон",
    "LGW": "Лондон (Гатвик)",
    "FRA": "Франкфурт",
    "IST": "Стамбул",
    "DXB": "Дубай",
    "BCN": "Барселона",
    "AMS": "Амстердам",
}

# Префиксы авиакомпаний для номеров рейсов (первые две буквы)
AIRLINE_PREFIXES = {
    "MeeAir": "MA",
    "SkyJet": "SJ",
    "FlyWorld": "FW",
    "AeroStar": "AS",
}

with app.app_context():
    from app import migrate_db
    db.create_all()
    migrate_db()

    # --- Страны и аэропорты ---
    for country_name, codes in countries_data.items():
        country = Country.query.filter_by(name=country_name).first()
        if not country:
            country = Country(name=country_name)
            db.session.add(country)
            db.session.flush()  # получаем id

        for code in codes:
            if not Airport.query.filter_by(code=code).first():
                airport = Airport(
                    code=code,
                    name=f"{code} International",
                    city=airport_cities.get(code, country_name),  # реальный город, если нет – название страны
                    country_id=country.id
                )
                db.session.add(airport)
    db.session.commit()

    # --- Рейсы (генерируем только если таблица пуста) ---
    if Flight.query.count() == 0:
        airports = Airport.query.all()
        existing_numbers = set()  # номера рейсов в текущей сессии

        for _ in range(240):
            from_ap = random.choice(airports)
            to_ap = random.choice(airports)
            if from_ap.id == to_ap.id:
                continue

            # Генерируем уникальный номер рейса
            while True:
                airline = random.choice(list(AIRLINE_PREFIXES.keys()))
                prefix = AIRLINE_PREFIXES[airline]
                number = random.randint(100, 999)
                flight_number = f"{prefix}-{number}"
                # Проверяем, что такого номера нет ни в базе, ни в текущем наборе
                if flight_number not in existing_numbers and \
                   not Flight.query.filter_by(flight_number=flight_number).first():
                    existing_numbers.add(flight_number)
                    break

            dep_h = random.randint(6, 23)
            dep_m = random.choice([0, 15, 30, 45])
            dep_time = f"{dep_h:02d}:{dep_m:02d}"
            dur_h = random.randint(1, 9)
            dur_m = random.choice([0, 15, 30, 45])
            duration = f"{dur_h}ч {dur_m}мин" if dur_m else f"{dur_h}ч"
            arr_h = (dep_h + dur_h + (dep_m + dur_m) // 60) % 24
            arr_m = (dep_m + dur_m) % 60
            arr_time = f"{arr_h:02d}:{arr_m:02d}"

            flight = Flight(
                flight_number=flight_number,
                airline=airline,
                from_airport_id=from_ap.id,
                to_airport_id=to_ap.id,
                departure_time=dep_time,
                arrival_time=arr_time,
                duration=duration,
                base_price=random.randint(100, 1200),
                seats_eco=random.randint(5, 50),
                seats_mid=random.randint(2, 15),
                seats_biz=random.randint(1, 8),
                status='active'
            )
            db.session.add(flight)

        db.session.commit()
        print("240 рейсов сгенерировано с уникальными номерами")
    else:
        print("Рейсы уже существуют, пропускаем генерацию")

    # --- Курсы валют ---
    if not CurrencyRate.query.first():
        db.session.add(CurrencyRate(currency='USD', rate=1.08))
        db.session.add(CurrencyRate(currency='RUB', rate=100.0))
        db.session.commit()
        print("Курсы валют добавлены")
    else:
        print("Курсы валют уже есть")

    # --- Администратор ---
    if not User.query.filter_by(email="admin@meeair.com").first():
        admin = User(
            username="Администратор",
            email="admin@meeair.com",
            password=generate_password_hash("admin123"),
            is_admin=True,
            email_confirmed=True,
        )
        db.session.add(admin)
        db.session.commit()
        print("Администратор создан: admin@meeair.com / admin123")
    else:
        admin = User.query.filter_by(email="admin@meeair.com").first()
        if not admin.email_confirmed:
            admin.email_confirmed = True
            db.session.commit()

    # --- Гостевой аккаунт для демо ---
    if not User.query.filter_by(email="guest@meeair.com").first():
        guest = User(
            username="Гость",
            email="guest@meeair.com",
            password=generate_password_hash("guests"),
            email_confirmed=True,
        )
        db.session.add(guest)
        db.session.commit()
        print("Гость создан: guest@meeair.com / guests")
    else:
        guest = User.query.filter_by(email="guest@meeair.com").first()
        if not guest.email_confirmed:
            guest.email_confirmed = True
            db.session.commit()

    print("Готово! База данных заполнена.")