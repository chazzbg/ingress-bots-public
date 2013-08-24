
import com.google.common.geometry.*;

import java.util.List;
import java.util.Iterator;

public class foo
{
  public static void main(String[] args)
  {
    double lat = Double.valueOf(args[0]);
    double lng = Double.valueOf(args[1]);
    int range = Integer.valueOf(args[2]);

    List<S2CellId> cellIds = getS2Cells(lat, lng, range);

    Iterator<S2CellId> iterator = cellIds.iterator();
    while (iterator.hasNext()) {
      System.out.println(Long.toHexString(iterator.next().id()));
    }
  }

  private static List<S2CellId> getS2Cells(double lat, double lng, int rangeMeters) {
    S2LatLng pointLatLon = S2LatLng.fromDegrees(lat, lng);
    int j1 = rangeMeters; // comm_range_filter
    S2Cap h1 = S2Cap.fromAxisAngle(pointLatLon.toPoint(), S1Angle.radians((double) j1 / 6371010D));
    S2RegionCoverer rCov = new S2RegionCoverer();
    return rCov.getCovering(h1).cellIds();
  }
}
