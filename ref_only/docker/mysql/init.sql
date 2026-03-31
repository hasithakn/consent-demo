CREATE DATABASE IF NOT EXISTS consent_mgt CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE consent_mgt;

SOURCE /docker-entrypoint-initdb.d/db_schema_mysql.sql;
