FROM alpine:3.19

RUN apk add --no-cache ca-certificates tzdata

WORKDIR /app

# Copy pre-built binary (cross-compiled for linux)
COPY target/server/consent-server ./consent-server
COPY consent-server/cmd/server/repository/ ./repository/
COPY consent-server/dbscripts/ ./dbscripts/
COPY api/ ./api/

RUN chmod +x ./consent-server

EXPOSE 3000

CMD ["./consent-server"]
