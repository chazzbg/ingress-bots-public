#!/bin/sh

if [ -z "$1" ] || [ -z "$2" ] || [ -z "$3" ]; then
  echo "usage: $0 LAT LNG RANGE"
  exit 1
fi

LINES=$( java -cp s2-geometry-library-java/build/s2-geometry-java.jar:s2-geometry-library-java/guava-14.0.1.jar:s2-geometry-library-java/. foo $1 $2 $3 )
LINES=$( echo $LINES | sed 's|^|["|g' | sed 's|$|"]|g' | sed 's| |","|g' )

echo $LINES
